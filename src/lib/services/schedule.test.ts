import { describe, expect, it } from "vitest";
import {
  PERIOD_DAYS,
  SCHEDULE_LABEL_MAX_LENGTH,
  SCHEDULE_MAX_DATE,
  SCHEDULE_MIN_DATE,
  STAFFING_MAX,
  STAFFING_MAX_CELLS,
  addDays,
  dayColumns,
  formatPeriod,
  parseIsoDate,
  periodEnd,
  sortSchedules,
  totalRequired,
  validateScheduleInput,
} from "@/lib/services/schedule";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import type { ScheduleField, ScheduleFieldErrors, ScheduleInput, ScheduleSummary } from "@/types";

// Shifts (the shift dictionary) and employees are referred to by id only.
const NIGHT = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";
const MORNING = "5f1c9a3e-2b7d-4e60-8c14-9a0d3e7b1f25";
const NOON = "a3d7e1f4-6c52-4b98-8e0a-1f9c2d5b7a36";
const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const CEZARY = "c0ffee00-1111-4222-8333-444455556666";

// Out of order on purpose (by shift id the order is NIGHT, MORNING), so the sorted result proves the normalisation.
const validInput = {
  startDate: "2026-11-11",
  label: "Tydzień 46",
  staffing: [
    { shiftId: MORNING, dayOffset: 1, requiredCount: 3 },
    { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 },
    { shiftId: MORNING, dayOffset: 0, requiredCount: 2 },
  ],
  employeeIds: [BARTEK, ANNA],
};

const validValueSorted: ScheduleInput = {
  startDate: "2026-11-11",
  label: "Tydzień 46",
  staffing: [
    { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 },
    { shiftId: MORNING, dayOffset: 0, requiredCount: 2 },
    { shiftId: MORNING, dayOffset: 1, requiredCount: 3 },
  ],
  employeeIds: [ANNA, BARTEK],
};

function validate(overrides: Record<string, unknown> = {}) {
  return validateScheduleInput({ ...validInput, ...overrides });
}

function validValue(overrides: Record<string, unknown> = {}): ScheduleInput {
  const result = validate(overrides);
  if (!result.ok) {
    throw new Error(`expected valid input, got errors for ${Object.keys(result.errors).join(", ")}`);
  }
  return result.value;
}

function errorsOf(overrides: Record<string, unknown> = {}): ScheduleFieldErrors {
  const result = validate(overrides);
  if (result.ok) {
    throw new Error(`expected invalid input, got ${JSON.stringify(result.value)}`);
  }
  return result.errors;
}

// Exactly one field is rejected, with a single non-empty message.
function expectOnlyError(overrides: Record<string, unknown>, field: ScheduleField) {
  const errors = errorsOf(overrides);
  expect(Object.keys(errors)).toStrictEqual([field]);
  expect(errors[field]?.trim().length).toBeGreaterThan(0);
}

// A grid of `count` different cells: seven days of each shift, shifts numbered from 1.
function gridOf(count: number): { shiftId: string; dayOffset: number; requiredCount: number }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    shiftId: `00000000-0000-4000-8000-${String(Math.floor(index / PERIOD_DAYS) + 1).padStart(12, "0")}`,
    dayOffset: index % PERIOD_DAYS,
    requiredCount: 1,
  }));
}

describe("schedule limits", () => {
  it("keeps the documented bounds", () => {
    expect([
      SCHEDULE_LABEL_MAX_LENGTH,
      STAFFING_MAX,
      PERIOD_DAYS,
      SCHEDULE_MIN_DATE,
      SCHEDULE_MAX_DATE,
      STAFFING_MAX_CELLS,
    ]).toStrictEqual([60, 99, 7, "2020-01-01", "2099-12-31", 350]);
  });
});

describe("parseIsoDate", () => {
  it.each<[string, number, number, number]>([
    ["2026-11-11", 2026, 11, 11],
    ["2024-02-29", 2024, 2, 29],
    ["2020-01-01", 2020, 1, 1],
    ["2099-12-31", 2099, 12, 31],
    ["2026-02-28", 2026, 2, 28],
    ["2026-04-30", 2026, 4, 30],
  ])("reads %s as a date", (text, year, month, day) => {
    expect(parseIsoDate(text)).toStrictEqual({ year, month, day });
  });

  it.each<[string, string]>([
    ["February 30", "2026-02-30"],
    ["February 29 in a year that is not a leap year", "2025-02-29"],
    ["month 13", "2026-13-01"],
    ["month 0", "2026-00-10"],
    ["day 0", "2026-11-00"],
    ["November 31", "2026-11-31"],
    ["a one-digit month and day", "2026-1-5"],
    ["a leading space", " 2026-11-11"],
    ["a trailing space", "2026-11-11 "],
    ["a trailing newline", "2026-11-11\n"],
    ["a time after the date", "2026-11-11T00:00:00"],
    ["slashes", "2026/11/11"],
    ["the day first", "11-11-2026"],
    ["a two-digit year", "26-11-11"],
    ["the day before the first accepted date", "2019-12-31"],
    ["the day after the last accepted date", "2100-01-01"],
    ["Arabic-Indic digits", "٢٠٢٦-١١-١١"],
    ["an empty string", ""],
    ["a number written out", "20261111"],
    ["a word", "today"],
  ])("rejects %s (%j)", (_label, text) => {
    expect(parseIsoDate(text)).toBeUndefined();
  });
});

describe("addDays and periodEnd", () => {
  it.each<[string, string, number, string]>([
    ["a week inside a month", "2026-11-11", 6, "2026-11-17"],
    ["a week over New Year", "2026-12-29", 6, "2027-01-04"],
    ["a month end", "2026-10-29", 3, "2026-11-01"],
    ["February in a leap year", "2028-02-27", 3, "2028-03-01"],
    ["February in a year that is not a leap year", "2026-02-27", 2, "2026-03-01"],
    ["the spring clock change (2026-03-29)", "2026-03-29", 6, "2026-04-04"],
    ["one day over the autumn clock change (2026-10-25)", "2026-10-25", 1, "2026-10-26"],
    ["no days", "2026-11-11", 0, "2026-11-11"],
    ["one day back over a month end", "2026-03-01", -1, "2026-02-28"],
    ["one day back to a leap day", "2028-03-01", -1, "2028-02-29"],
    ["a day back over New Year", "2027-01-01", -1, "2026-12-31"],
    ["a whole common year", "2026-01-01", 365, "2027-01-01"],
    ["a whole leap year", "2028-01-01", 366, "2029-01-01"],
    ["a result after the accepted range", "2099-12-31", 6, "2100-01-06"],
    ["a result before the accepted range", "2020-01-01", -1, "2019-12-31"],
  ])("%s: %s plus %d days is %s", (_label, start, days, expected) => {
    expect(addDays(start, days)).toBe(expected);
  });

  it("ends the period six days after the start", () => {
    expect(periodEnd("2026-11-11")).toBe("2026-11-17");
    expect(periodEnd("2026-12-29")).toBe("2027-01-04");
    expect(periodEnd("2028-02-26")).toBe("2028-03-03");
  });

  it("counts every day of the accepted range, one after the other", () => {
    const first = Date.UTC(2020, 0, 1);
    const days = Math.round((Date.UTC(2099, 11, 31) - first) / 86_400_000);
    let current = SCHEDULE_MIN_DATE;

    for (let day = 1; day <= days; day++) {
      current = addDays(current, 1);
      // toISOString is independent of the code under test and always UTC.
      expect(current).toBe(new Date(first + day * 86_400_000).toISOString().slice(0, 10));
    }
    expect(current).toBe(SCHEDULE_MAX_DATE);
  });

  it.each<[string, string]>([
    ["February 30", "2026-02-30"],
    ["a date before the accepted range", "2019-12-31"],
    ["a date after the accepted range", "2100-01-01"],
    ["a malformed date", "2026-1-5"],
    ["an empty string", ""],
  ])("throws for %s as the start", (_label, start) => {
    expect(() => addDays(start, 1)).toThrow(RangeError);
    expect(() => periodEnd(start)).toThrow(RangeError);
  });

  it.each<[string, number]>([
    ["a fraction", 1.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])("throws for %s as the number of days", (_label, days) => {
    expect(() => addDays("2026-11-11", days)).toThrow(RangeError);
  });
});

describe("dayColumns", () => {
  it("lists the seven days from a Wednesday with the weekday of each date", () => {
    expect(dayColumns("2026-11-11").map((column) => column.label)).toStrictEqual([
      "śr. 11.11",
      "czw. 12.11",
      "pt. 13.11",
      "sob. 14.11",
      "niedz. 15.11",
      "pon. 16.11",
      "wt. 17.11",
    ]);
  });

  it("gives the offset, the date and the weekday of each column", () => {
    expect(dayColumns("2026-11-11")[0]).toStrictEqual({
      offset: 0,
      date: "2026-11-11",
      weekday: "śr.",
      label: "śr. 11.11",
    });
    expect(dayColumns("2026-11-11")[6]).toStrictEqual({
      offset: 6,
      date: "2026-11-17",
      weekday: "wt.",
      label: "wt. 17.11",
    });
    expect(dayColumns("2026-11-11").map((column) => column.offset)).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("starts with the weekday of the start date, not on a Monday", () => {
    // 2026-11-15 is a Sunday and 2026-11-16 a Monday.
    expect(dayColumns("2026-11-15").map((column) => column.weekday)).toStrictEqual([
      "niedz.",
      "pon.",
      "wt.",
      "śr.",
      "czw.",
      "pt.",
      "sob.",
    ]);
    expect(dayColumns("2026-11-16")[0].weekday).toBe("pon.");
  });

  it.each<[string, string]>([
    ["2020-01-01", "śr."],
    ["2024-02-29", "czw."],
    ["2026-03-29", "niedz."],
    ["2026-11-11", "śr."],
    ["2026-12-25", "pt."],
  ])("names the weekday of %s as %s", (date, weekday) => {
    expect(dayColumns(date)[0].weekday).toBe(weekday);
  });

  it("pads the day and the month with a zero and crosses a month end", () => {
    expect(dayColumns("2026-10-29").map((column) => column.label)).toStrictEqual([
      "czw. 29.10",
      "pt. 30.10",
      "sob. 31.10",
      "niedz. 01.11",
      "pon. 02.11",
      "wt. 03.11",
      "śr. 04.11",
    ]);
  });

  it("crosses New Year and a leap day with real dates", () => {
    expect(dayColumns("2026-12-29").map((column) => column.date)).toStrictEqual([
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
    ]);
    expect(dayColumns("2028-02-27").map((column) => column.date)).toContain("2028-02-29");
  });

  it("ends on the last day of the period", () => {
    for (const start of ["2026-11-11", "2026-12-29", "2028-02-26", "2099-12-31"]) {
      expect(dayColumns(start)[PERIOD_DAYS - 1].date).toBe(periodEnd(start));
    }
  });

  it("throws for a date that is not valid", () => {
    expect(() => dayColumns("2026-02-30")).toThrow(RangeError);
    expect(() => dayColumns("")).toThrow(RangeError);
  });

  it("gives the same columns for repeated calls", () => {
    const columns = expectDeterministic(dayColumns, "2026-11-11");

    expect(columns).toHaveLength(PERIOD_DAYS);
  });
});

describe("formatPeriod", () => {
  it.each<[string, string, string]>([
    ["inside one month", "2026-11-11", "11.11–17.11.2026"],
    ["over a month end", "2026-10-28", "28.10–03.11.2026"],
    ["over New Year", "2026-12-29", "29.12.2026–04.01.2027"],
    ["over a leap day", "2028-02-26", "26.02–03.03.2028"],
    ["from the first day of the year", "2026-01-01", "01.01–07.01.2026"],
    ["ending on the last day of the year", "2026-12-25", "25.12–31.12.2026"],
    ["from the first accepted date", "2020-01-01", "01.01–07.01.2020"],
    ["from the last accepted date", "2099-12-31", "31.12.2099–06.01.2100"],
  ])("writes a period %s: %s as %s", (_label, start, expected) => {
    expect(formatPeriod(start)).toBe(expected);
  });

  it("joins the ends with an en dash (U+2013), not a hyphen", () => {
    expect(formatPeriod("2026-11-11")[5]).toBe("–");
    expect(formatPeriod("2026-12-29")).not.toContain("-");
  });

  it("throws for a date that is not valid", () => {
    expect(() => formatPeriod("2026-02-30")).toThrow(RangeError);
  });

  it("gives the same text for repeated calls", () => {
    expect(expectDeterministic(formatPeriod, "2026-12-29")).toBe("29.12.2026–04.01.2027");
  });
});

describe("validateScheduleInput", () => {
  it("normalises the cells and the employees to a canonical order", () => {
    expect(validValue()).toStrictEqual(validValueSorted);
  });

  it("accepts the smallest schedule: one cell of the largest count on the last day and one employee", () => {
    expect(
      validValue({ staffing: [{ shiftId: NIGHT, dayOffset: 6, requiredCount: 99 }], employeeIds: [CEZARY] }),
    ).toStrictEqual({
      startDate: "2026-11-11",
      label: "Tydzień 46",
      staffing: [{ shiftId: NIGHT, dayOffset: 6, requiredCount: 99 }],
      employeeIds: [CEZARY],
    });
  });
});

describe("validateScheduleInput start date", () => {
  it.each(["2026-11-11", "2024-02-29", "2020-01-01", "2099-12-31"])("accepts %s", (startDate) => {
    expect(validValue({ startDate }).startDate).toBe(startDate);
  });

  it.each<[string, unknown]>([
    ["February 30", "2026-02-30"],
    ["February 29 in a year that is not a leap year", "2025-02-29"],
    ["month 13", "2026-13-01"],
    ["November 31", "2026-11-31"],
    ["a one-digit month and day", "2026-1-5"],
    ["a leading space", " 2026-11-11"],
    ["a trailing newline", "2026-11-11\n"],
    ["the day before the first accepted date", "2019-12-31"],
    ["the day after the last accepted date", "2100-01-01"],
    ["an empty value", ""],
    ["a missing value", undefined],
    ["null", null],
    ["a number", 20261111],
    ["a timestamp in milliseconds", Date.UTC(2026, 10, 11)],
    ["a date object", new Date(Date.UTC(2026, 10, 11))],
    ["an array holding a date", ["2026-11-11"]],
  ])("rejects %s", (_label, startDate) => {
    expectOnlyError({ startDate }, "startDate");
  });
});

describe("validateScheduleInput label", () => {
  it.each<[string, unknown, string | null]>([
    ["a missing value", undefined, null],
    ["null", null, null],
    ["an empty string", "", null],
    ["spaces only", "   ", null],
    ["a no-break space only", " ", null],
    ["a plain label", "Tydzień 46", "Tydzień 46"],
    ["a Polish letter", "Łąka", "Łąka"],
    ["outer spaces", "  Tydzień 46  ", "Tydzień 46"],
    ["a double space", "Tydzień  46", "Tydzień 46"],
    ["a no-break space inside", "Tydzień 46", "Tydzień 46"],
    ["the maximum length", "a".repeat(SCHEDULE_LABEL_MAX_LENGTH), "a".repeat(SCHEDULE_LABEL_MAX_LENGTH)],
    ["the maximum length in emoji", "😀".repeat(SCHEDULE_LABEL_MAX_LENGTH), "😀".repeat(SCHEDULE_LABEL_MAX_LENGTH)],
    ["an invisible character next to a letter", "Gru​dzień", "Gru​dzień"],
    [
      "an emoji sequence joined with zero-width joiners",
      "\u{1F468}‍\u{1F469}‍\u{1F467}",
      "\u{1F468}‍\u{1F469}‍\u{1F467}",
    ],
  ])("accepts %s", (_name, label, expected) => {
    expect(validValue({ label }).label).toBe(expected);
  });

  it("treats a schedule without a label key like one with a null label", () => {
    const withoutLabel = Object.fromEntries(Object.entries(validInput).filter(([key]) => key !== "label"));

    const result = validateScheduleInput(withoutLabel);

    expect(result).toStrictEqual({ ok: true, value: { ...validValueSorted, label: null } });
  });

  it.each<[string, unknown]>([
    ["one character too many", "a".repeat(SCHEDULE_LABEL_MAX_LENGTH + 1)],
    ["one emoji too many", "😀".repeat(SCHEDULE_LABEL_MAX_LENGTH + 1)],
    ["a number", 46],
    ["true", true],
    ["an array", ["Tydzień 46"]],
    ["a null character", "Tydzień\u0000"],
    ["a tab inside", "Tydzień\t46"],
    ["a newline inside", "Tydzień\n46"],
    ["a trailing newline", "Tydzień 46\n"],
    ["a leading tab", "\tTydzień 46"],
    ["a delete character", "Tydzień\u007f"],
    ["a C1 control character", "Tydzień\u0085"],
    ["only a zero-width space", "​"],
    ["only a Hangul filler", "ㅤ"],
    ["only a braille blank", "⠀"],
    ["only spaces and zero-width spaces", " ​ ​ "],
    ["a lone high surrogate", "Tydz\uD800"],
    ["a lone low surrogate", "\uDC00Tydz"],
  ])("rejects %s", (_name, label) => {
    expectOnlyError({ label }, "label");
  });

  it("counts the length in code points after collapsing spaces", () => {
    // 30 + 29 emoji and a double space: 61 characters before collapsing, 60 after, so the label fits.
    expect(validValue({ label: `${"😀".repeat(30)}  ${"😀".repeat(29)}` }).label).toBe(
      `${"😀".repeat(30)} ${"😀".repeat(29)}`,
    );
    // One emoji more and it no longer does.
    expectOnlyError({ label: `${"😀".repeat(30)}  ${"😀".repeat(30)}` }, "label");
  });
});

describe("validateScheduleInput staffing", () => {
  it.each<[string, number]>([
    ["the smallest count", 1],
    ["the largest count", STAFFING_MAX],
  ])("accepts %s (%d)", (_label, requiredCount) => {
    const value = validValue({ staffing: [{ shiftId: NIGHT, dayOffset: 0, requiredCount }] });

    expect(value.staffing).toStrictEqual([{ shiftId: NIGHT, dayOffset: 0, requiredCount }]);
  });

  it.each([0, 3, 6])("accepts day offset %d", (dayOffset) => {
    expect(validValue({ staffing: [{ shiftId: NIGHT, dayOffset, requiredCount: 1 }] }).staffing[0].dayOffset).toBe(
      dayOffset,
    );
  });

  it.each<[string, unknown]>([
    ["0", 0],
    ["100", STAFFING_MAX + 1],
    ["a negative count", -1],
    ["1.5", 1.5],
    ["the string 2", "2"],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["null", null],
    ["a missing value", undefined],
  ])("rejects a required count of %s", (_label, requiredCount) => {
    expectOnlyError({ staffing: [{ shiftId: NIGHT, dayOffset: 0, requiredCount }] }, "staffing");
  });

  it.each<[string, unknown]>([
    ["-1", -1],
    ["7", PERIOD_DAYS],
    ["1.5", 1.5],
    ["the string 0", "0"],
    ["NaN", NaN],
    ["null", null],
    ["a missing value", undefined],
  ])("rejects a day offset of %s", (_label, dayOffset) => {
    expectOnlyError({ staffing: [{ shiftId: NIGHT, dayOffset, requiredCount: 1 }] }, "staffing");
  });

  it.each<[string, unknown]>([
    ["text that is not an id", "not-a-uuid"],
    ["an empty string", ""],
    ["an id with a trailing newline", `${NIGHT}\n`],
    ["an id with a character missing", NIGHT.slice(1)],
    ["a number", 7],
    ["null", null],
    ["a missing value", undefined],
  ])("rejects a shift id that is %s", (_label, shiftId) => {
    expectOnlyError({ staffing: [{ shiftId, dayOffset: 0, requiredCount: 1 }] }, "staffing");
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "cell"],
    ["a number", 5],
    ["an array", []],
    ["an empty object", {}],
  ])("rejects a cell that is %s", (_label, cell) => {
    expectOnlyError({ staffing: [{ shiftId: NIGHT, dayOffset: 0, requiredCount: 1 }, cell] }, "staffing");
  });

  it("rejects a hole in the list of cells", () => {
    const staffing: unknown[] = [{ shiftId: NIGHT, dayOffset: 0, requiredCount: 1 }];
    staffing.length = 3;

    expectOnlyError({ staffing }, "staffing");
  });

  it.each<[string, unknown]>([
    ["an empty list", []],
    ["a missing value", undefined],
    ["null", null],
    ["an object", { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 }],
    ["a string", "[]"],
  ])("rejects %s instead of the list of cells", (_label, staffing) => {
    expectOnlyError({ staffing }, "staffing");
  });

  it("rejects the same shift on the same day twice, whatever the count", () => {
    expectOnlyError(
      {
        staffing: [
          { shiftId: NIGHT, dayOffset: 2, requiredCount: 1 },
          { shiftId: MORNING, dayOffset: 2, requiredCount: 1 },
          { shiftId: NIGHT, dayOffset: 2, requiredCount: 5 },
        ],
      },
      "staffing",
    );
  });

  it("rejects the same shift id spelled in two letter cases as one cell", () => {
    expectOnlyError(
      {
        staffing: [
          { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 },
          { shiftId: NIGHT.toUpperCase(), dayOffset: 0, requiredCount: 1 },
        ],
      },
      "staffing",
    );
  });

  it("accepts the same shift on different days and different shifts on the same day", () => {
    const staffing = [
      { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 },
      { shiftId: NIGHT, dayOffset: 1, requiredCount: 1 },
      { shiftId: MORNING, dayOffset: 0, requiredCount: 1 },
      { shiftId: NOON, dayOffset: 0, requiredCount: 1 },
    ];

    expect(validValue({ staffing }).staffing).toHaveLength(4);
  });

  it("accepts a full grid of 50 shifts over seven days and rejects one cell more", () => {
    expect(validValue({ staffing: gridOf(STAFFING_MAX_CELLS) }).staffing).toHaveLength(STAFFING_MAX_CELLS);
    expectOnlyError({ staffing: gridOf(STAFFING_MAX_CELLS + 1) }, "staffing");
  });

  it("keeps the shift id in lower case", () => {
    const value = validValue({ staffing: [{ shiftId: NIGHT.toUpperCase(), dayOffset: 0, requiredCount: 1 }] });

    expect(value.staffing[0].shiftId).toBe(NIGHT);
  });

  it("turns a negative zero day offset from JSON into zero", () => {
    const staffing: unknown = JSON.parse(`[{"shiftId":"${NIGHT}","dayOffset":-0,"requiredCount":1}]`);

    expect(validValue({ staffing }).staffing[0].dayOffset).toBe(0);
  });

  it("copies the cells instead of passing the input objects through", () => {
    const cell = { shiftId: NIGHT, dayOffset: 0, requiredCount: 1, note: "ignored" };

    const [copy] = validValue({ staffing: [cell] }).staffing;

    expect(copy).not.toBe(cell);
    expect(copy).toStrictEqual({ shiftId: NIGHT, dayOffset: 0, requiredCount: 1 });
  });

  it("words each cause differently", () => {
    const messages = [
      errorsOf({ staffing: [] }).staffing,
      errorsOf({ staffing: gridOf(STAFFING_MAX_CELLS + 1) }).staffing,
      errorsOf({ staffing: [{ shiftId: NIGHT, dayOffset: 0, requiredCount: 0 }] }).staffing,
      errorsOf({
        staffing: [
          { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 },
          { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 },
        ],
      }).staffing,
    ];

    expect(new Set(messages).size).toBe(4);
  });
});

describe("totalRequired", () => {
  it("adds up the required counts of the whole grid", () => {
    expect(totalRequired(validValueSorted.staffing)).toBe(6);
  });

  it("gives zero for an empty grid", () => {
    expect(totalRequired([])).toBe(0);
  });

  it("adds a full grid of the largest counts", () => {
    const staffing = gridOf(STAFFING_MAX_CELLS).map((cell) => ({ ...cell, requiredCount: STAFFING_MAX }));

    expect(totalRequired(staffing)).toBe(STAFFING_MAX_CELLS * STAFFING_MAX);
  });
});

describe("validateScheduleInput employees", () => {
  it("accepts one employee", () => {
    expect(validValue({ employeeIds: [CEZARY] }).employeeIds).toStrictEqual([CEZARY]);
  });

  it("drops repeated employees quietly and sorts the rest", () => {
    expect(validValue({ employeeIds: [BARTEK, ANNA, BARTEK, ANNA, CEZARY] }).employeeIds).toStrictEqual([
      ANNA,
      BARTEK,
      CEZARY,
    ]);
  });

  it("treats an id spelled in two letter cases as one employee and keeps it in lower case", () => {
    expect(validValue({ employeeIds: [ANNA.toUpperCase(), ANNA] }).employeeIds).toStrictEqual([ANNA]);
  });

  it.each<[string, unknown]>([
    ["an empty list", []],
    ["a missing value", undefined],
    ["null", null],
    ["a string", ANNA],
    ["an object", { [ANNA]: true }],
  ])("rejects %s instead of the list of employees", (_label, employeeIds) => {
    expectOnlyError({ employeeIds }, "employeeIds");
  });

  it.each<[string, unknown]>([
    ["text that is not an id", "not-a-uuid"],
    ["an empty string", ""],
    ["an id with a trailing space", `${ANNA} `],
    ["a number", 1],
    ["null", null],
    ["an object holding an id", { id: ANNA }],
  ])("rejects a list holding %s", (_label, entry) => {
    expectOnlyError({ employeeIds: [ANNA, entry] }, "employeeIds");
  });

  it("words an empty list differently from a bad id", () => {
    expect(errorsOf({ employeeIds: [] }).employeeIds).not.toBe(errorsOf({ employeeIds: ["x"] }).employeeIds);
  });
});

describe("validateScheduleInput errors", () => {
  it("returns every invalid field at once", () => {
    const errors = errorsOf({ startDate: "2026-02-30", label: "a".repeat(61), staffing: [], employeeIds: [] });

    expect(Object.keys(errors).sort()).toStrictEqual(["employeeIds", "label", "staffing", "startDate"]);
    for (const message of Object.values(errors)) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives each field its own message", () => {
    const errors = errorsOf({ startDate: "2026-02-30", label: "a".repeat(61), staffing: [], employeeIds: [] });

    expect(new Set(Object.values(errors)).size).toBe(4);
  });

  it("reports a bad date next to a good grid and good employees", () => {
    expectOnlyError({ startDate: "11.11.2026" }, "startDate");
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string", "2026-11-11"],
    ["a number", 42],
    ["a boolean", true],
    ["an array", []],
    ["an empty object", {}],
  ])("treats %s as empty fields and reports the required ones", (_label, raw) => {
    const result = validateScheduleInput(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The label is optional, so only the other three are required.
      expect(Object.keys(result.errors).sort()).toStrictEqual(["employeeIds", "staffing", "startDate"]);
    }
  });
});

describe("validateScheduleInput repeatability", () => {
  const variantsOf = (input: typeof validInput) => [
    // Cells and employees in another order, and with a repeated employee.
    { ...input, staffing: [...input.staffing].reverse(), employeeIds: [...input.employeeIds].reverse() },
    { ...input, employeeIds: [...input.employeeIds, input.employeeIds[0]] },
    // Letter case of the ids and a spaced label.
    {
      ...input,
      label: "  Tydzień   46 ",
      staffing: input.staffing.map((cell) => ({ ...cell, shiftId: cell.shiftId.toUpperCase() })),
      employeeIds: input.employeeIds.map((id) => id.toUpperCase()),
    },
    // Key order, of the schedule and of every cell.
    { employeeIds: input.employeeIds, label: input.label, startDate: input.startDate, staffing: input.staffing },
    {
      ...input,
      staffing: input.staffing.map((cell) => ({
        requiredCount: cell.requiredCount,
        dayOffset: cell.dayOffset,
        shiftId: cell.shiftId,
      })),
    },
    ...[1, 2, 3, 4, 5].map((seed) => ({
      ...input,
      staffing: seededShuffle(input.staffing, seed),
      employeeIds: seededShuffle(input.employeeIds, seed),
    })),
  ];

  it("gives the same result for repeated calls and for the same data in any order", () => {
    const result = expectDeterministic(validateScheduleInput, validInput, { variants: variantsOf(validInput) });

    expect(result).toStrictEqual({ ok: true, value: validValueSorted });
  });

  it("gives the same value for any order of a larger grid and a larger team", () => {
    const input = {
      ...validInput,
      staffing: gridOf(70).map((cell, index) => ({ ...cell, requiredCount: (index % STAFFING_MAX) + 1 })),
      employeeIds: [ANNA, BARTEK, CEZARY, NIGHT, MORNING, NOON],
    };

    const result = expectDeterministic(validateScheduleInput, input, {
      variants: [1, 2, 3, 4, 5, 6].map((seed) => ({
        ...input,
        staffing: seededShuffle(input.staffing, seed),
        employeeIds: seededShuffle(input.employeeIds, seed),
      })),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.staffing.map((cell) => `${cell.shiftId}/${cell.dayOffset}`)).toStrictEqual(
        gridOf(70).map((cell) => `${cell.shiftId}/${cell.dayOffset}`),
      );
    }
  });

  it("gives the same errors for repeated calls and for key order", () => {
    const input = { startDate: "2026-02-30", label: "a".repeat(61), staffing: [], employeeIds: [] };
    const variants = [1, 2, 3].map((seed) => Object.fromEntries(seededShuffle(Object.entries(input), seed)));

    const result = expectDeterministic(validateScheduleInput, input, { variants });

    expect(result.ok).toBe(false);
  });

  it("does not change its input", () => {
    const input = structuredClone(validInput);
    const before = structuredClone(input);

    validateScheduleInput(input);

    expect(input).toStrictEqual(before);
  });
});

function summary(id: string, startDate: string, createdAt = "2026-01-01T10:00:00.000Z"): ScheduleSummary {
  return { id, startDate, label: null, createdAt, employeeCount: 3, totalRequired: 10 };
}

const idsOf = (list: readonly { id: string }[]) => list.map((entry) => entry.id);

describe("sortSchedules order", () => {
  it("puts the latest period first, over month and year ends", () => {
    // By id (and by creation time) the order would be the reverse, so only the start date can produce this.
    const list = [
      summary("a", "2026-11-04", "2026-03-01T10:00:00Z"),
      summary("b", "2026-11-11", "2026-02-01T10:00:00Z"),
      summary("c", "2026-12-29", "2026-01-01T10:00:00Z"),
      summary("d", "2027-01-05", "2025-12-01T10:00:00Z"),
    ];

    for (const seed of [1, 2, 3]) {
      expect(idsOf(sortSchedules(seededShuffle(list, seed)))).toStrictEqual(["d", "c", "b", "a"]);
    }
  });

  it("compares start dates as dates, not as day numbers", () => {
    const list = [summary("a", "2026-02-09"), summary("b", "2026-11-02"), summary("c", "2026-02-10")];

    expect(idsOf(sortSchedules(list))).toStrictEqual(["b", "c", "a"]);
  });

  it("orders the same period by creation time, latest first, then by id", () => {
    const list = [
      summary("a", "2026-11-11", "2026-02-01T10:00:00.000Z"),
      summary("c", "2026-11-11", "2026-03-01T10:00:00.000Z"),
      summary("b", "2026-11-11", "2026-03-01T10:00:00.000Z"),
    ];

    expect(idsOf(sortSchedules(list))).toStrictEqual(["b", "c", "a"]);
    expect(idsOf(sortSchedules([...list].reverse()))).toStrictEqual(["b", "c", "a"]);
  });

  // The later timestamp gets the later id, so an id comparison would put the earlier one first.
  it.each([
    ["different offsets", "2026-01-01T10:30:00+00:00", "2026-01-01T11:00:00+02:00"],
    ["a missing and a present fraction", "2026-01-01T10:00:00.5Z", "2026-01-01T10:00:00Z"],
    ["fractions of different length", "2026-01-01T10:00:00.12Z", "2026-01-01T10:00:00.1Z"],
    ["a different number of fraction digits", "2026-01-01T10:00:00.123456+00:00", "2026-01-01T10:00:00.1Z"],
  ])("compares creation times as points in time with %s", (_label, later, earlier) => {
    const first = summary("z", "2026-11-11", later);
    const second = summary("a", "2026-11-11", earlier);

    expect(idsOf(sortSchedules([second, first]))).toStrictEqual(["z", "a"]);
    expect(idsOf(sortSchedules([first, second]))).toStrictEqual(["z", "a"]);
  });

  it("falls back to the id when different spellings give the same instant", () => {
    const list = [
      summary("c", "2026-11-11", "2026-01-01T12:00:00+02:00"),
      summary("b", "2026-11-11", "2026-01-01T10:00:00.000Z"),
      summary("a", "2026-11-11", "2026-01-01T10:00:00Z"),
    ];

    expect(idsOf(sortSchedules(list))).toStrictEqual(["a", "b", "c"]);
  });

  it("keeps the other fields of a full schedule", () => {
    const schedule = { id: "x", createdAt: "2026-01-01T10:00:00Z", ...validValueSorted };

    const [sorted] = sortSchedules([schedule]);

    expect(sorted).toStrictEqual(schedule);
  });

  it("gives an empty list for an empty list", () => {
    expect(sortSchedules([])).toStrictEqual([]);
  });
});

describe("sortSchedules repeatability", () => {
  const roster = [
    summary("w-1", "2026-11-11", "2026-03-01T10:00:00.000Z"),
    summary("w-2", "2026-11-11", "2026-03-01T10:00:00Z"),
    summary("old", "2026-10-28"),
    summary("w-late", "2026-11-11", "2026-04-05T09:00:00.5+00:00"),
    summary("new-year", "2026-12-29"),
    summary("w-early", "2026-11-11", "2026-02-05T09:00:00.123456+00:00"),
    summary("next-year", "2027-01-05"),
    summary("future", "2099-12-31"),
    summary("oldest", "2020-01-01"),
    summary("same-day", "2026-11-12"),
  ];

  it("gives the same order for repeated calls and for any input order", () => {
    const variants = [1, 2, 3, 4, 5, 6].map((seed) => seededShuffle(roster, seed));

    const sorted = expectDeterministic(sortSchedules, roster, { variants });

    expect(idsOf(sorted)).toStrictEqual([
      "future",
      "next-year",
      "new-year",
      "same-day",
      "w-late",
      "w-1",
      "w-2",
      "w-early",
      "old",
      "oldest",
    ]);
  });

  it("returns a new array and leaves the input unchanged", () => {
    const input = Object.freeze(seededShuffle(roster, 7));
    const before = structuredClone(input);

    const sorted = sortSchedules(input);

    expect(sorted).not.toBe(input);
    expect(input).toStrictEqual(before);
  });
});
