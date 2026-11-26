import { describe, expect, it } from "vitest";
import {
  ABSENCE_TYPES,
  absenceInterval,
  absenceTypeLabel,
  dayOffsetOf,
  excusedWeekdays,
  formatAbsenceRange,
  rangesOverlap,
  sortAbsences,
  validateAbsenceInput,
} from "@/lib/services/absence";
import { holidaysInWeek } from "@/lib/services/calendar";
import { shiftInterval } from "@/lib/services/work-hours";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import { localDateMethodsCalledBy } from "@/lib/testing/local-time";
import type { Absence, AbsenceField, AbsenceFieldErrors, AbsenceInput, AbsenceStatus, AbsenceType } from "@/types";

const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
// The dash that joins the two ends of a range; kept apart from the text so that it is never a hyphen by accident.
const DASH = String.fromCharCode(0x2013);

const validInput = { employeeId: ANNA, type: "vacation", startDate: "2026-11-02", endDate: "2026-11-06" };

function validate(overrides: Record<string, unknown> = {}) {
  return validateAbsenceInput({ ...validInput, ...overrides });
}

function validValue(overrides: Record<string, unknown> = {}): AbsenceInput {
  const result = validate(overrides);
  if (!result.ok) {
    throw new Error(`expected valid input, got errors for ${Object.keys(result.errors).join(", ")}`);
  }
  return result.value;
}

function errorsOf(overrides: Record<string, unknown> = {}): AbsenceFieldErrors {
  const result = validate(overrides);
  if (result.ok) {
    throw new Error(`expected invalid input, got ${JSON.stringify(result.value)}`);
  }
  return result.errors;
}

// Exactly these fields are rejected, each with a single non-empty message.
function expectOnlyErrors(overrides: Record<string, unknown>, fields: AbsenceField[]) {
  const errors = errorsOf(overrides);
  expect(Object.keys(errors).sort()).toStrictEqual([...fields].sort());
  for (const field of fields) {
    expect(errors[field]?.trim().length).toBeGreaterThan(0);
  }
}

describe("ABSENCE_TYPES and absenceTypeLabel", () => {
  it("lists the three types in the order of the form, each with its Polish label", () => {
    expect(ABSENCE_TYPES).toStrictEqual([
      { value: "vacation", label: "Urlop" },
      { value: "sick_leave", label: "Zwolnienie lekarskie (L4)" },
      { value: "other", label: "Inna nieobecność" },
    ]);
  });

  it.each<[AbsenceType, string]>([
    ["vacation", "Urlop"],
    ["sick_leave", "Zwolnienie lekarskie (L4)"],
    ["other", "Inna nieobecność"],
  ])("labels %s as %j", (type, label) => {
    expect(absenceTypeLabel(type)).toBe(label);
  });
});

describe("validateAbsenceInput", () => {
  it("accepts a valid absence and gives back the four fields", () => {
    expect(validate()).toStrictEqual({
      ok: true,
      value: { employeeId: ANNA, type: "vacation", startDate: "2026-11-02", endDate: "2026-11-06" },
    });
  });

  it.each<AbsenceType>(["vacation", "sick_leave", "other"])("accepts the type %s", (type) => {
    expect(validValue({ type }).type).toBe(type);
  });

  it("leaves out other keys, such as a status, an id or a note, instead of passing them through", () => {
    expect(
      validValue({ status: "requested", id: "x", note: "grypa", createdAt: "2026-11-01T10:00:00Z" }),
    ).toStrictEqual({
      employeeId: ANNA,
      type: "vacation",
      startDate: "2026-11-02",
      endDate: "2026-11-06",
    });
  });

  it("keeps the id of the employee in lower case", () => {
    expect(validValue({ employeeId: ANNA.toUpperCase() }).employeeId).toBe(ANNA);
  });

  it("copies the values instead of passing the input object through", () => {
    const input = { ...validInput };

    const result = validateAbsenceInput(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBe(input);
    }
  });

  it.each<{ label: string; startDate: string; endDate: string }>([
    { label: "the first accepted day on both ends", startDate: "2020-01-01", endDate: "2020-01-01" },
    { label: "the first accepted day as the start", startDate: "2020-01-01", endDate: "2020-01-31" },
    { label: "the last accepted day on both ends", startDate: "2099-12-31", endDate: "2099-12-31" },
    { label: "the last accepted day as the end", startDate: "2099-12-01", endDate: "2099-12-31" },
    { label: "the whole accepted range", startDate: "2020-01-01", endDate: "2099-12-31" },
    { label: "one day", startDate: "2026-11-04", endDate: "2026-11-04" },
    { label: "a leap day", startDate: "2028-02-29", endDate: "2028-02-29" },
    { label: "an absence over New Year", startDate: "2026-12-28", endDate: "2027-01-04" },
  ])("accepts $label ($startDate to $endDate)", ({ startDate, endDate }) => {
    expect(validValue({ startDate, endDate })).toStrictEqual({ ...validInput, startDate, endDate });
  });

  it.each<{ label: string; overrides: Record<string, unknown>; fields: AbsenceField[] }>([
    { label: "a start the day before 2020", overrides: { startDate: "2019-12-31" }, fields: ["startDate"] },
    {
      label: "an end the day after 2099",
      overrides: { startDate: "2099-12-30", endDate: "2100-01-01" },
      fields: ["endDate"],
    },
    {
      label: "a start after 2099",
      overrides: { startDate: "2100-01-01", endDate: "2100-01-02" },
      fields: ["startDate", "endDate"],
    },
    {
      label: "both days before 2020",
      overrides: { startDate: "2019-12-30", endDate: "2019-12-31" },
      fields: ["startDate", "endDate"],
    },
    {
      label: "an absence from before 2020 into 2020",
      overrides: { startDate: "2019-12-31", endDate: "2020-01-02" },
      fields: ["startDate"],
    },
    { label: "a year of 3 digits", overrides: { startDate: "999-01-01" }, fields: ["startDate"] },
    { label: "an impossible day, 30 February", overrides: { endDate: "2026-02-30" }, fields: ["endDate"] },
    {
      label: "29 February in a year that is not a leap year",
      overrides: { startDate: "2027-02-29", endDate: "2027-03-01" },
      fields: ["startDate"],
    },
    { label: "month 13", overrides: { startDate: "2026-13-01" }, fields: ["startDate"] },
    { label: "a day without the leading zero", overrides: { startDate: "2026-11-2" }, fields: ["startDate"] },
    { label: "a date with a space at the end", overrides: { endDate: "2026-11-06 " }, fields: ["endDate"] },
    { label: "a date with a time", overrides: { startDate: "2026-11-02T00:00:00Z" }, fields: ["startDate"] },
    { label: "a date in the order of people", overrides: { startDate: "02.11.2026" }, fields: ["startDate"] },
    { label: "an empty start", overrides: { startDate: "" }, fields: ["startDate"] },
    { label: "an empty end", overrides: { endDate: "" }, fields: ["endDate"] },
    { label: "a start that is a number", overrides: { startDate: 20261102 }, fields: ["startDate"] },
    { label: "an end that is null", overrides: { endDate: null }, fields: ["endDate"] },
    { label: "a start that is missing", overrides: { startDate: undefined }, fields: ["startDate"] },
    { label: "an end that is an object", overrides: { endDate: { year: 2026 } }, fields: ["endDate"] },
  ])("rejects $label", ({ overrides, fields }) => {
    expectOnlyErrors(overrides, fields);
  });

  it("rejects an end before the start on the end, with a message of its own", () => {
    const errors = errorsOf({ startDate: "2026-11-06", endDate: "2026-11-05" });

    expect(Object.keys(errors)).toStrictEqual(["endDate"]);
    expect(errors.endDate).not.toBe(errorsOf({ endDate: "nie data" }).endDate);
    expect(errors.endDate?.trim().length).toBeGreaterThan(0);
  });

  it.each<{ label: string; startDate: string; endDate: string }>([
    { label: "by one day", startDate: "2026-11-06", endDate: "2026-11-05" },
    { label: "across a month", startDate: "2026-11-01", endDate: "2026-10-31" },
    { label: "across New Year", startDate: "2027-01-01", endDate: "2026-12-31" },
    { label: "at the first accepted day", startDate: "2020-01-02", endDate: "2020-01-01" },
    { label: "at the last accepted day", startDate: "2099-12-31", endDate: "2099-12-30" },
  ])("rejects an end before the start $label", ({ startDate, endDate }) => {
    expectOnlyErrors({ startDate, endDate }, ["endDate"]);
  });

  it("does not compare the end with a start that is not a date, and reports the format of the start", () => {
    expectOnlyErrors({ startDate: "2026-02-30", endDate: "2026-01-01" }, ["startDate"]);
  });

  it("does not report an end before the start when the end is not a date either", () => {
    const errors = errorsOf({ startDate: "2026-11-06", endDate: "2026-11-5" });

    expect(errors.endDate).toBe(errorsOf({ endDate: "nie data" }).endDate);
  });

  it.each<[string, unknown]>([
    ["an empty text", ""],
    ["a word", "pracownik"],
    ["a text that is almost an id", "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5"],
    ["an id without the dashes", "1c2d3e4f5a6b4c7d8e9f0a1b2c3d4e5f"],
    ["an id with a space at the end", `${ANNA} `],
    ["an id with a letter that is not hexadecimal", "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5g"],
    ["a number", 123],
    ["null", null],
    ["undefined", undefined],
    ["an array of the id", [ANNA]],
  ])("rejects an employee that is %s", (_label, employeeId) => {
    expectOnlyErrors({ employeeId }, ["employeeId"]);
  });

  it.each<[string, unknown]>([
    ["a type that is not on the list", "holiday"],
    ["a type in upper case", "VACATION"],
    ["a type with a space", "vacation "],
    ["an empty text", ""],
    ["the label instead of the value", "Urlop"],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
    ["a name from the prototype", "__proto__"],
    ["a name of a method", "toString"],
  ])("rejects %s as the type", (_label, type) => {
    expectOnlyErrors({ type }, ["type"]);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["a text", "absence"],
    ["a number", 5],
    ["an empty array", []],
    ["an empty object", {}],
  ])("reports all four fields for %s", (_label, raw) => {
    const result = validateAbsenceInput(raw);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toStrictEqual(["employeeId", "endDate", "startDate", "type"]);
    }
  });

  it("reports every invalid field at once, one message each, and a different message for each field", () => {
    const result = validateAbsenceInput({ employeeId: "x", type: "y", startDate: "2019-12-31", endDate: "2100-01-01" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = Object.values(result.errors);
      expect(Object.keys(result.errors).sort()).toStrictEqual(["employeeId", "endDate", "startDate", "type"]);
      expect(messages.every((message) => message.trim().length > 0)).toBe(true);
      expect(new Set(messages).size).toBe(4);
    }
  });

  it("names the accepted range of dates in the messages of both dates", () => {
    const errors = errorsOf({ startDate: "2019-12-31", endDate: "2100-01-01" });

    expect(errors.startDate).toContain("2020-01-01");
    expect(errors.startDate).toContain("2099-12-31");
    expect(errors.endDate).toContain("2020-01-01");
    expect(errors.endDate).toContain("2099-12-31");
  });

  it("leaves the input unchanged, frozen or not, for a valid and for an invalid absence", () => {
    const valid = Object.freeze({ ...validInput });
    const invalid = Object.freeze({ employeeId: "x", type: "y", startDate: "z", endDate: "w", status: "requested" });
    const before = structuredClone({ valid, invalid });

    validateAbsenceInput(valid);
    validateAbsenceInput(invalid);

    expect(structuredClone({ valid, invalid })).toStrictEqual(before);
  });

  it("gives the same answer for repeated calls and for the same fields in another order, with or without other keys", () => {
    const base = { ...validInput };
    const reversed = Object.fromEntries(Object.entries(base).reverse());

    const result = expectDeterministic(validateAbsenceInput, base, {
      variants: [reversed, { ...base, status: "requested" }, { id: "x", ...reversed }],
    });

    expect(result).toStrictEqual({ ok: true, value: validInput });

    const bad = { ...base, type: "holiday", endDate: "2026-11-01" };
    const errors = expectDeterministic(validateAbsenceInput, bad, {
      variants: [Object.fromEntries(Object.entries(bad).reverse())],
    });

    expect(errors.ok).toBe(false);
  });
});

describe("dayOffsetOf", () => {
  it.each<[string, string, string, number]>([
    ["the same day", "2026-11-02", "2026-11-02", 0],
    ["the next day", "2026-11-02", "2026-11-03", 1],
    ["the last day of the week", "2026-11-02", "2026-11-08", 6],
    ["the day after the week", "2026-11-02", "2026-11-09", 7],
    ["the day before", "2026-11-02", "2026-11-01", -1],
    ["a week before", "2026-11-02", "2026-10-26", -7],
    ["32 days before, over a month of 31 days", "2026-11-02", "2026-10-01", -32],
    ["over New Year", "2026-12-28", "2027-01-02", 5],
    ["over 29 February in a leap year", "2028-02-28", "2028-03-01", 2],
    ["over the end of February in a year that is not a leap year", "2027-02-28", "2027-03-01", 1],
    ["over the spring change of the clocks in Poland", "2026-03-28", "2026-03-30", 2],
    ["over the autumn change of the clocks in Poland", "2026-10-24", "2026-10-26", 2],
    ["from the first accepted day to the last", "2020-01-01", "2099-12-31", 29_219],
    ["from the last accepted day to the first", "2099-12-31", "2020-01-01", -29_219],
  ])("counts %s: from %s to %s is %i", (_label, startDate, isoDate, days) => {
    expect(dayOffsetOf(startDate, isoDate)).toBe(days);
  });

  it("never gives a negative zero", () => {
    expect(Object.is(dayOffsetOf("2026-11-02", "2026-11-02"), 0)).toBe(true);
  });

  it.each<[string, string, string]>([
    ["a day after 2099", "2026-11-02", "2100-01-01"],
    ["a day before 2020", "2026-11-02", "2019-12-31"],
    ["a start after 2099", "2100-01-01", "2026-11-02"],
    ["a start before 2020", "2019-12-31", "2026-11-02"],
    ["an impossible day", "2026-11-02", "2026-02-30"],
    ["a day with a time", "2026-11-02", "2026-11-03T00:00:00Z"],
    ["an empty text", "2026-11-02", ""],
  ])("throws a RangeError for %s", (_label, startDate, isoDate) => {
    expect(() => dayOffsetOf(startDate, isoDate)).toThrow(RangeError);
  });
});

describe("absenceInterval", () => {
  // The schedule starts on Monday 2 November 2026 (day 0), so the week ends on Sunday 8 November (day 6).
  it.each<{ label: string; startDate: string; endDate: string; start: number; end: number }>([
    { label: "Monday to Friday", startDate: "2026-11-02", endDate: "2026-11-06", start: 0, end: 7200 },
    { label: "one day, Thursday", startDate: "2026-11-05", endDate: "2026-11-05", start: 4320, end: 5760 },
    {
      label: "the last day of the week only",
      startDate: "2026-11-08",
      endDate: "2026-11-08",
      start: 8640,
      end: 10_080,
    },
    { label: "the whole week", startDate: "2026-11-02", endDate: "2026-11-08", start: 0, end: 10_080 },
    {
      label: "an absence that begins before the schedule and ends inside it",
      startDate: "2026-10-30",
      endDate: "2026-11-03",
      start: -4320,
      end: 2880,
    },
    {
      label: "an absence that begins inside the schedule and ends after it",
      startDate: "2026-11-06",
      endDate: "2026-11-20",
      start: 5760,
      end: 27_360,
    },
    {
      label: "an absence entirely before the schedule",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      start: -46_080,
      end: -38_880,
    },
    {
      label: "an absence entirely after the schedule",
      startDate: "2026-11-20",
      endDate: "2026-11-22",
      start: 25_920,
      end: 30_240,
    },
    { label: "the day after the week", startDate: "2026-11-09", endDate: "2026-11-09", start: 10_080, end: 11_520 },
  ])("puts $label from minute $start to minute $end", ({ startDate, endDate, start, end }) => {
    expect(absenceInterval("2026-11-02", { startDate, endDate })).toStrictEqual({ start, end });
  });

  it("ends a full day after the last day, so a one-day absence is 1440 minutes long", () => {
    const { start, end } = absenceInterval("2026-11-02", { startDate: "2026-11-04", endDate: "2026-11-04" });

    expect(end - start).toBe(1440);
  });

  it("takes a full absence, with its other fields, without changing it", () => {
    const absence: Absence = Object.freeze({
      id: "a1",
      employeeId: ANNA,
      type: "sick_leave",
      status: "approved",
      startDate: "2026-11-03",
      endDate: "2026-11-04",
      createdAt: "2026-11-01T10:00:00Z",
    });
    const before = structuredClone(absence);

    expect(absenceInterval("2026-11-02", absence)).toStrictEqual({ start: 1440, end: 4320 });
    expect(absence).toStrictEqual(before);
  });

  it.each<[string, string, string, string]>([
    ["a start of the schedule after 2099", "2100-01-01", "2026-11-02", "2026-11-03"],
    ["a start of the absence before 2020", "2026-11-02", "2019-12-31", "2026-11-03"],
    ["an end of the absence after 2099", "2026-11-02", "2026-11-03", "2100-01-01"],
  ])("throws a RangeError for %s", (_label, startDate, absenceStart, absenceEnd) => {
    expect(() => absenceInterval(startDate, { startDate: absenceStart, endDate: absenceEnd })).toThrow(RangeError);
  });
});

describe("rangesOverlap", () => {
  it.each<{ label: string; a: [number, number]; b: [number, number]; overlap: boolean }>([
    { label: "the same interval", a: [0, 10], b: [0, 10], overlap: true },
    { label: "an interval that ends where the other starts", a: [0, 10], b: [10, 20], overlap: false },
    { label: "an interval that ends one minute after the other starts", a: [0, 11], b: [10, 20], overlap: true },
    { label: "an interval inside the other", a: [0, 100], b: [40, 41], overlap: true },
    { label: "an interval one minute long at the end of the other", a: [0, 10], b: [9, 10], overlap: true },
    { label: "intervals with a gap of one minute", a: [0, 10], b: [11, 20], overlap: false },
    { label: "intervals far apart", a: [0, 10], b: [1000, 2000], overlap: false },
    { label: "intervals before the schedule, which have negative minutes", a: [-10, -5], b: [-7, 0], overlap: true },
    { label: "an interval that ends at 0 and one that starts at 0", a: [-5, 0], b: [0, 5], overlap: false },
  ])("says $overlap for $label, whichever one comes first", ({ a, b, overlap }) => {
    const first = { start: a[0], end: a[1] };
    const second = { start: b[0], end: b[1] };

    expect(rangesOverlap(first, second)).toBe(overlap);
    expect(rangesOverlap(second, first)).toBe(overlap);
  });

  // A shift belongs to the day it starts on and an absence takes whole days, both on the minutes of the schedule.
  describe("a shift against an absence", () => {
    const night = { startMinute: 1320, endMinute: 360 };
    const evening = { startMinute: 960, endMinute: 0 };
    const morning = { startMinute: 360, endMinute: 840 };
    // Wednesday 4 November (day 2) to Thursday 5 November (day 3).
    const absence = absenceInterval("2026-11-02", { startDate: "2026-11-04", endDate: "2026-11-05" });

    it.each<{ label: string; shift: { startMinute: number; endMinute: number }; dayOffset: number; overlap: boolean }>([
      { label: "a morning shift on the first day", shift: morning, dayOffset: 2, overlap: true },
      { label: "a morning shift on the last day", shift: morning, dayOffset: 3, overlap: true },
      { label: "a morning shift on the day before", shift: morning, dayOffset: 1, overlap: false },
      { label: "a morning shift on the day after", shift: morning, dayOffset: 4, overlap: false },
      {
        label: "a night shift on the evening before, which runs into the first day",
        shift: night,
        dayOffset: 1,
        overlap: true,
      },
      {
        label: "a night shift that starts on the last day and ends after it",
        shift: night,
        dayOffset: 3,
        overlap: true,
      },
      { label: "a night shift on the evening after the last day", shift: night, dayOffset: 4, overlap: false },
      {
        label: "an evening shift that ends exactly at midnight, when the absence starts",
        shift: evening,
        dayOffset: 1,
        overlap: false,
      },
      {
        label: "an evening shift on the last day, which ends exactly where the absence ends",
        shift: evening,
        dayOffset: 3,
        overlap: true,
      },
      { label: "an evening shift on the day after the last day", shift: evening, dayOffset: 4, overlap: false },
    ])("says $overlap for $label", ({ shift, dayOffset, overlap }) => {
      expect(rangesOverlap(shiftInterval(shift, dayOffset), absence)).toBe(overlap);
      expect(rangesOverlap(absence, shiftInterval(shift, dayOffset))).toBe(overlap);
    });
  });
});

describe("formatAbsenceRange", () => {
  it.each<{ label: string; startDate: string; endDate: string; text: string }>([
    { label: "days in one month", startDate: "2026-11-02", endDate: "2026-11-03", text: `02.11${DASH}03.11.2026` },
    { label: "a working week", startDate: "2026-11-02", endDate: "2026-11-06", text: `02.11${DASH}06.11.2026` },
    { label: "days in two months", startDate: "2026-10-28", endDate: "2026-11-02", text: `28.10${DASH}02.11.2026` },
    {
      label: "days over New Year, with the year on both ends",
      startDate: "2026-12-29",
      endDate: "2027-01-04",
      text: `29.12.2026${DASH}04.01.2027`,
    },
    { label: "a single day", startDate: "2026-11-02", endDate: "2026-11-02", text: "02.11.2026" },
    { label: "a single day in the last month", startDate: "2026-12-24", endDate: "2026-12-24", text: "24.12.2026" },
    { label: "the first accepted day", startDate: "2020-01-01", endDate: "2020-01-01", text: "01.01.2020" },
    { label: "the last accepted day", startDate: "2099-12-31", endDate: "2099-12-31", text: "31.12.2099" },
    {
      label: "the whole accepted range",
      startDate: "2020-01-01",
      endDate: "2099-12-31",
      text: `01.01.2020${DASH}31.12.2099`,
    },
  ])("writes $label as $text", ({ startDate, endDate, text }) => {
    expect(formatAbsenceRange({ startDate, endDate })).toBe(text);
  });

  it("joins the days with an en dash (U+2013) and not with a hyphen", () => {
    const text = formatAbsenceRange({ startDate: "2026-11-02", endDate: "2026-11-06" });

    expect(text).toContain(DASH);
    expect(text).not.toContain("-");
    expect(DASH.charCodeAt(0)).toBe(0x2013);
  });

  it("writes a single day without a dash", () => {
    expect(formatAbsenceRange({ startDate: "2026-11-02", endDate: "2026-11-02" })).not.toContain(DASH);
  });

  it.each<[string, string, string]>([
    ["a start after 2099", "2100-01-01", "2100-01-02"],
    ["an end before 2020", "2019-12-30", "2019-12-31"],
    ["an impossible day", "2026-02-30", "2026-03-02"],
    ["an empty end", "2026-11-02", ""],
  ])("throws a RangeError for %s", (_label, startDate, endDate) => {
    expect(() => formatAbsenceRange({ startDate, endDate })).toThrow(RangeError);
  });
});

interface Away {
  startDate: string;
  endDate: string;
  status: AbsenceStatus;
}

function away(startDate: string, endDate: string, status: AbsenceStatus = "approved"): Away {
  return { startDate, endDate, status };
}

describe("excusedWeekdays", () => {
  // The week of Monday 2 November 2026: Monday 2 to Friday 6, Saturday 7 and Sunday 8 November. It has no holiday.
  const WEEK = "2026-11-02";
  // The week of Monday 9 November has 11 November (a Wednesday), a holiday, in it. Sunday 15 November is its last day.
  const HOLIDAY_WEEK = "2026-11-09";
  const NOVEMBER_HOLIDAY = ["2026-11-11"];

  it.each<{ label: string; startDate: string; absences: Away[]; holidays: string[]; excused: string[] }>([
    { label: "no absence", startDate: WEEK, absences: [], holidays: [], excused: [] },
    {
      label: "an absence from Monday to Wednesday",
      startDate: WEEK,
      absences: [away("2026-11-02", "2026-11-04")],
      holidays: [],
      excused: ["2026-11-02", "2026-11-03", "2026-11-04"],
    },
    {
      label: "a one-day absence",
      startDate: WEEK,
      absences: [away("2026-11-04", "2026-11-04")],
      holidays: [],
      excused: ["2026-11-04"],
    },
    {
      label: "an absence that begins before the schedule and ends inside it",
      startDate: WEEK,
      absences: [away("2026-10-28", "2026-11-04")],
      holidays: [],
      excused: ["2026-11-02", "2026-11-03", "2026-11-04"],
    },
    {
      label: "an absence that begins inside the schedule and ends after it, so Saturday and Sunday stay out",
      startDate: WEEK,
      absences: [away("2026-11-05", "2026-11-20")],
      holidays: [],
      excused: ["2026-11-05", "2026-11-06"],
    },
    {
      label: "an absence that covers the whole week and more",
      startDate: WEEK,
      absences: [away("2026-10-30", "2026-11-15")],
      holidays: [],
      excused: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    },
    {
      label: "an absence entirely before the schedule",
      startDate: WEEK,
      absences: [away("2026-10-01", "2026-10-05")],
      holidays: [],
      excused: [],
    },
    {
      label: "an absence that ends on the Sunday before the schedule",
      startDate: WEEK,
      absences: [away("2026-10-26", "2026-11-01")],
      holidays: [],
      excused: [],
    },
    {
      label: "an absence that begins on Monday, the day after the seven days",
      startDate: WEEK,
      absences: [away("2026-11-09", "2026-11-13")],
      holidays: [],
      excused: [],
    },
    {
      label: "an absence entirely after the schedule",
      startDate: WEEK,
      absences: [away("2026-11-20", "2026-11-22")],
      holidays: [],
      excused: [],
    },
    {
      label: "an absence that ends on the first day of the schedule",
      startDate: WEEK,
      absences: [away("2026-10-30", "2026-11-02")],
      holidays: [],
      excused: ["2026-11-02"],
    },
    {
      label: "an absence only on Saturday and Sunday",
      startDate: WEEK,
      absences: [away("2026-11-07", "2026-11-08")],
      holidays: [],
      excused: [],
    },
    {
      label: "an absence on a Sunday only, the last day of the schedule",
      startDate: WEEK,
      absences: [away("2026-11-08", "2026-11-08")],
      holidays: [],
      excused: [],
    },
    {
      label: "an absence over the whole of seven days, of which only Monday to Friday count",
      startDate: WEEK,
      absences: [away("2026-11-02", "2026-11-08")],
      holidays: [],
      excused: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    },
    {
      label:
        "a schedule that starts on a Wednesday, where the weekdays follow the dates and not the days of the schedule",
      startDate: "2026-11-04",
      absences: [away("2026-11-01", "2026-11-30")],
      holidays: [],
      excused: ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"],
    },
    {
      label: "a schedule that starts on a Saturday",
      startDate: "2026-11-14",
      absences: [away("2026-11-14", "2026-11-20")],
      holidays: [],
      excused: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"],
    },
    {
      label: "a holiday inside an absence, which does not count a second time",
      startDate: HOLIDAY_WEEK,
      absences: [away("2026-11-09", "2026-11-13")],
      holidays: NOVEMBER_HOLIDAY,
      excused: ["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13"],
    },
    {
      label: "an absence on the holiday only",
      startDate: HOLIDAY_WEEK,
      absences: [away("2026-11-11", "2026-11-11")],
      holidays: NOVEMBER_HOLIDAY,
      excused: [],
    },
    {
      label: "the week of Tuesday 10 November, with the holiday inside a whole week of absence",
      startDate: "2026-11-10",
      absences: [away("2026-11-10", "2026-11-16")],
      holidays: NOVEMBER_HOLIDAY,
      excused: ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-16"],
    },
    {
      label: "the holiday that is not in the list given, which counts like any working day",
      startDate: HOLIDAY_WEEK,
      absences: [away("2026-11-11", "2026-11-11")],
      holidays: [],
      excused: ["2026-11-11"],
    },
    {
      label: "the turn of the year, with 1 January a holiday on a Friday",
      startDate: "2026-12-28",
      absences: [away("2026-12-28", "2027-01-03")],
      holidays: ["2027-01-01"],
      excused: ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"],
    },
  ])("takes $excused.length days of the week for $label", ({ startDate, absences, holidays, excused }) => {
    expect(excusedWeekdays(startDate, absences, holidays)).toStrictEqual(excused);
  });

  it("gives the same days with the holidays of the week as the calendar lists them", () => {
    for (const startDate of [HOLIDAY_WEEK, "2026-11-10", "2026-12-28", "2025-12-22"]) {
      const holidays = holidaysInWeek(startDate);
      const days = excusedWeekdays(startDate, [away("2025-12-01", "2027-01-31")], holidays);

      expect(
        days.some((day) => holidays.includes(day)),
        startDate,
      ).toBe(false);
    }
    // The week of 22 December 2025 has 24, 25 and 26 December in it, and so two working days are left.
    expect(
      excusedWeekdays("2025-12-22", [away("2025-12-22", "2025-12-28")], holidaysInWeek("2025-12-22")),
    ).toStrictEqual(["2025-12-22", "2025-12-23"]);
  });

  it.each<{ label: string; status: AbsenceStatus; excused: string[] }>([
    { label: "an approved absence", status: "approved", excused: ["2026-11-03", "2026-11-04"] },
    { label: "a requested absence, which is not decided", status: "requested", excused: [] },
    { label: "a rejected absence", status: "rejected", excused: [] },
  ])("counts $label as $excused.length days", ({ status, excused }) => {
    expect(excusedWeekdays(WEEK, [away("2026-11-03", "2026-11-04", status)], [])).toStrictEqual(excused);
  });

  it("takes only the approved absence when the others cover other days or the same ones", () => {
    const absences = [
      away("2026-11-02", "2026-11-06", "rejected"),
      away("2026-11-04", "2026-11-04"),
      away("2026-11-05", "2026-11-06", "requested"),
    ];

    expect(excusedWeekdays(WEEK, absences, [])).toStrictEqual(["2026-11-04"]);
  });

  it("lists each day once and in order, however many absences cover it", () => {
    const absences = [
      away("2026-11-04", "2026-11-05"),
      away("2026-11-02", "2026-11-04"),
      away("2026-11-03", "2026-11-03"),
      away("2026-11-04", "2026-11-04"),
      away("2026-10-20", "2026-11-02"),
    ];

    expect(excusedWeekdays(WEEK, absences, [])).toStrictEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  });

  it("gives the same days for repeated calls and for any order of the absences and of the holidays", () => {
    const roster = [
      away("2026-11-02", "2026-11-03"),
      away("2026-11-03", "2026-11-05"),
      away("2026-11-06", "2026-11-06", "requested"),
      away("2026-11-04", "2026-11-08", "rejected"),
      away("2026-11-04", "2026-11-04"),
      away("2026-10-20", "2026-10-31"),
      away("2026-11-12", "2026-11-13"),
      away("2026-11-07", "2026-11-08"),
    ];
    // 5 November is a holiday here, so that the order of the holidays has something to change.
    const holidays = ["2026-11-05", "2026-12-24", "2026-12-25"];
    const run = (input: { absences: Away[]; holidays: string[] }) =>
      excusedWeekdays(WEEK, input.absences, input.holidays);

    const days = expectDeterministic(
      run,
      { absences: roster, holidays },
      {
        variants: [1, 2, 3, 4, 5, 6].map((seed) => ({
          absences: seededShuffle(roster, seed),
          holidays: seededShuffle(holidays, seed + 100),
        })),
      },
    );

    expect(days).toStrictEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  it("leaves the absences and the holidays unchanged, and returns a new list", () => {
    const absences = Object.freeze(
      [away("2026-11-02", "2026-11-04"), away("2026-11-03", "2026-11-05")].map((entry) => Object.freeze(entry)),
    );
    const holidays = Object.freeze(["2026-11-04"]);
    const before = structuredClone({ absences, holidays });

    const days = excusedWeekdays(WEEK, absences, holidays);

    expect(structuredClone({ absences, holidays })).toStrictEqual(before);
    expect(Object.isFrozen(days)).toBe(false);
    expect(days).toStrictEqual(["2026-11-02", "2026-11-03", "2026-11-05"]);
  });

  it.each(["", "2026-02-30", "2019-12-31", "2100-01-01", "2026-11-02 "])(
    "throws a RangeError for the start date %j",
    (startDate) => {
      expect(() => excusedWeekdays(startDate, [], [])).toThrow(RangeError);
    },
  );

  it("gives a week that reaches into 2100 from the last accepted day", () => {
    // Thursday 31 December 2099, then Friday 1 January 2100 and the weekend, then Monday 4 to Wednesday 6 January 2100.
    expect(excusedWeekdays("2099-12-31", [away("2099-12-30", "2099-12-31")], [])).toStrictEqual(["2099-12-31"]);
  });
});

describe("sortAbsences", () => {
  function absence(id: string, startDate: string, endDate = startDate): Absence {
    return {
      id,
      employeeId: ANNA,
      type: "vacation",
      status: "approved",
      startDate,
      endDate,
      createdAt: "2026-11-01T10:00:00Z",
    };
  }

  it("puts the latest start first, then the id", () => {
    const sorted = sortAbsences([
      absence("c", "2026-10-01"),
      absence("b", "2026-11-09"),
      absence("a", "2026-11-09"),
      absence("d", "2027-01-04"),
      absence("e", "2026-11-02", "2026-11-30"),
    ]);

    expect(sorted.map(({ id }) => id)).toStrictEqual(["d", "a", "b", "e", "c"]);
  });

  it("orders the ids by code unit, so that upper case comes before lower case and a digit before a letter", () => {
    const sorted = sortAbsences([
      absence("b", "2026-11-02"),
      absence("B", "2026-11-02"),
      absence("1", "2026-11-02"),
      absence("a", "2026-11-02"),
    ]);

    expect(sorted.map(({ id }) => id)).toStrictEqual(["1", "B", "a", "b"]);
  });

  it("does not look at the end date or at the person", () => {
    const sorted = sortAbsences([
      { ...absence("z", "2026-11-02", "2026-11-02"), employeeId: BARTEK },
      absence("y", "2026-11-02", "2026-12-31"),
    ]);

    expect(sorted.map(({ id }) => id)).toStrictEqual(["y", "z"]);
  });

  it("sorts a list row with only the id and the start", () => {
    expect(
      sortAbsences([
        { id: "a", startDate: "2026-11-02" },
        { id: "b", startDate: "2026-11-03" },
      ]),
    ).toStrictEqual([
      { id: "b", startDate: "2026-11-03" },
      { id: "a", startDate: "2026-11-02" },
    ]);
  });

  it("gives an empty list for none", () => {
    expect(sortAbsences([])).toStrictEqual([]);
  });

  it("gives the same order for repeated calls and for any order of the input", () => {
    const roster = [
      absence("e", "2026-11-09"),
      absence("c", "2026-11-09"),
      absence("a", "2026-11-02", "2026-11-06"),
      absence("b", "2026-11-02"),
      absence("d", "2027-01-04"),
      absence("f", "2026-10-01"),
      absence("g", "2026-10-01"),
    ];

    const sorted = expectDeterministic(sortAbsences<Absence>, roster, {
      variants: [1, 2, 3, 4, 5, 6].map((seed) => seededShuffle(roster, seed)),
    });

    expect(sorted.map(({ id }) => id)).toStrictEqual(["d", "c", "e", "a", "b", "f", "g"]);
  });

  it("returns a new list and leaves the input, frozen or not, unchanged", () => {
    const list = Object.freeze(
      [absence("b", "2026-11-02"), absence("a", "2026-11-09")].map((entry) => Object.freeze(entry)),
    );
    const before = structuredClone(list);

    const sorted = sortAbsences(list);

    expect(structuredClone(list)).toStrictEqual(before);
    expect(sorted).not.toBe(list);
    expect(sorted.map(({ id }) => id)).toStrictEqual(["a", "b"]);
  });
});

describe("the time zone", () => {
  it("calls no method of Date that reads or writes the local time", () => {
    const called = localDateMethodsCalledBy(() => {
      validateAbsenceInput({ ...validInput, startDate: "2099-12-31", endDate: "2099-12-31" });
      validateAbsenceInput({ ...validInput, startDate: "2019-12-31" });
      dayOffsetOf("2026-03-28", "2026-03-30");
      dayOffsetOf("2020-01-01", "2099-12-31");
      absenceInterval("2026-11-02", { startDate: "2026-10-30", endDate: "2026-11-03" });
      rangesOverlap({ start: 0, end: 10 }, { start: 5, end: 15 });
      formatAbsenceRange({ startDate: "2026-12-29", endDate: "2027-01-04" });
      formatAbsenceRange({ startDate: "2026-11-02", endDate: "2026-11-02" });
      absenceTypeLabel("sick_leave");
      excusedWeekdays("2026-11-10", [away("2026-11-01", "2026-11-30")], holidaysInWeek("2026-11-10"));
      excusedWeekdays("2099-12-31", [away("2099-12-31", "2099-12-31")], holidaysInWeek("2099-12-31"));
      sortAbsences([
        { id: "a", startDate: "2026-11-02" },
        { id: "b", startDate: "2026-11-03" },
      ]);
    });

    expect(called).toStrictEqual([]);
  });
});
