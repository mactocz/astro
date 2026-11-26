import { describe, expect, it } from "vitest";
import { excusedWeekdays } from "@/lib/services/absence";
import { holidaysInWeek } from "@/lib/services/calendar";
import { formatDuration } from "@/lib/services/shift";
import {
  exceedsNorm,
  normMinutes,
  shiftInterval,
  weeklyNorm,
  weeklyNormExcused,
  weeklyNormWithHolidays,
  workedMinutesByEmployee,
  type ShiftTimes,
  type WeeklyNorm,
} from "@/lib/services/work-hours";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import { localDateMethodsCalledBy } from "@/lib/testing/local-time";
import type { AbsenceStatus, AssignmentInput, Fte } from "@/types";

// The shifts are referred to by id only. By id they order as NIGHT, MORNING, LONG, and the employees as ANNA, BARTEK,
// CEZARY, which is not the order of the names, so only a sort by id can produce it.
const NIGHT = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";
const MORNING = "5f1c9a3e-2b7d-4e60-8c14-9a0d3e7b1f25";
const LONG = "a3d7e1f4-6c52-4b98-8e0a-1f9c2d5b7a36";
const UNKNOWN = "00000000-0000-4000-8000-000000000001";
const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const CEZARY = "c0ffee00-1111-4222-8333-444455556666";

// 06:00-14:00 (8 h), 22:00-06:00 the next day (8 h) and 08:00-20:00 (12 h).
const MORNING_SHIFT: ShiftTimes = { id: MORNING, name: "Poranna", startMinute: 360, endMinute: 840 };
const NIGHT_SHIFT: ShiftTimes = { id: NIGHT, name: "Nocna", startMinute: 1320, endMinute: 360 };
const LONG_SHIFT: ShiftTimes = { id: LONG, name: "Długa", startMinute: 480, endMinute: 1200 };
const SHIFTS = [MORNING_SHIFT, NIGHT_SHIFT, LONG_SHIFT];

function assignment(shiftId: string, dayOffset: number, employeeId: string): AssignmentInput {
  return { shiftId, dayOffset, employeeId };
}

describe("shiftInterval", () => {
  it.each<{ label: string; shift: ShiftTimes; dayOffset: number; start: number; end: number }>([
    { label: "a morning shift on day 0", shift: MORNING_SHIFT, dayOffset: 0, start: 360, end: 840 },
    { label: "a morning shift on day 3", shift: MORNING_SHIFT, dayOffset: 3, start: 4680, end: 5160 },
    { label: "a night shift on day 0, which ends on day 1", shift: NIGHT_SHIFT, dayOffset: 0, start: 1320, end: 1800 },
    {
      label: "a night shift on day 6, which ends after the last day",
      shift: NIGHT_SHIFT,
      dayOffset: 6,
      start: 9960,
      end: 10440,
    },
    { label: "a long shift on day 6", shift: LONG_SHIFT, dayOffset: 6, start: 9120, end: 9840 },
    {
      label: "a shift that starts at midnight",
      shift: { id: "s", name: "Rano", startMinute: 0, endMinute: 480 },
      dayOffset: 2,
      start: 2880,
      end: 3360,
    },
    {
      label: "a shift that ends at midnight",
      shift: { id: "s", name: "Wieczór", startMinute: 960, endMinute: 0 },
      dayOffset: 1,
      start: 2400,
      end: 2880,
    },
  ])("puts $label from minute $start to minute $end", ({ shift, dayOffset, start, end }) => {
    expect(shiftInterval(shift, dayOffset)).toStrictEqual({ start, end });
  });

  it("ends past the 7 × 1440 = 10080 minutes of the week only for a shift that crosses midnight on day 6", () => {
    expect(shiftInterval(NIGHT_SHIFT, 6).end).toBeGreaterThan(10080);
    expect(shiftInterval(MORNING_SHIFT, 6).end).toBeLessThan(10080);
  });

  it("leaves the shift unchanged", () => {
    const shift = Object.freeze({ ...NIGHT_SHIFT });

    expect(shiftInterval(shift, 2)).toStrictEqual({ start: 4200, end: 4680 });
    expect(shift).toStrictEqual(NIGHT_SHIFT);
  });
});

describe("workedMinutesByEmployee", () => {
  it("adds up the full durations of the shifts of each person", () => {
    const worked = workedMinutesByEmployee(
      [
        assignment(LONG, 2, ANNA),
        assignment(MORNING, 0, BARTEK),
        assignment(NIGHT, 1, ANNA),
        assignment(MORNING, 0, ANNA),
      ],
      SHIFTS,
    );

    // 12 h + 8 h + 8 h for Anna and 8 h for Bartek.
    expect(worked).toStrictEqual({ [ANNA]: 1680, [BARTEK]: 480 });
  });

  it("lists the people in sorted order, whatever the order of the assignments", () => {
    const worked = workedMinutesByEmployee(
      [assignment(MORNING, 0, CEZARY), assignment(MORNING, 0, BARTEK), assignment(MORNING, 0, ANNA)],
      SHIFTS,
    );

    expect(Object.keys(worked)).toStrictEqual([ANNA, BARTEK, CEZARY]);
  });

  it.each<[string, AssignmentInput[], number]>([
    ["a night shift that starts on day 6", [assignment(NIGHT, 6, ANNA)], 480],
    ["a long shift that starts on day 6", [assignment(LONG, 6, ANNA)], 720],
    ["two shifts on one day", [assignment(MORNING, 0, ANNA), assignment(NIGHT, 0, ANNA)], 960],
    ["shifts on every day", Array.from({ length: 7 }, (_unused, day) => assignment(LONG, day, ANNA)), 5040],
  ])("counts %s in full", (_label, assignments, minutes) => {
    expect(workedMinutesByEmployee(assignments, SHIFTS)).toStrictEqual({ [ANNA]: minutes });
  });

  it("leaves out an assignment to a shift it has no hours for, and so a person with nothing else", () => {
    const worked = workedMinutesByEmployee(
      [assignment(UNKNOWN, 0, ANNA), assignment(MORNING, 1, BARTEK), assignment(UNKNOWN, 2, BARTEK)],
      SHIFTS,
    );

    expect(worked).toStrictEqual({ [BARTEK]: 480 });
  });

  it("counts the same assignment twice as one", () => {
    const worked = workedMinutesByEmployee(
      [assignment(MORNING, 0, ANNA), assignment(MORNING, 0, ANNA), assignment(MORNING, 1, ANNA)],
      SHIFTS,
    );

    expect(worked).toStrictEqual({ [ANNA]: 960 });
  });

  it("gives an empty object for no assignments, and for no shifts", () => {
    expect(workedMinutesByEmployee([], SHIFTS)).toStrictEqual({});
    expect(workedMinutesByEmployee([assignment(MORNING, 0, ANNA)], [])).toStrictEqual({});
  });

  it("returns a new object and leaves the input unchanged", () => {
    const assignments = Object.freeze(
      [assignment(NIGHT, 1, ANNA), assignment(MORNING, 0, BARTEK)].map((entry) => Object.freeze(entry)),
    );
    const shifts = Object.freeze(SHIFTS.map((shift) => Object.freeze({ ...shift })));
    const before = structuredClone({ assignments, shifts });

    const worked = workedMinutesByEmployee(assignments, shifts);

    expect(structuredClone({ assignments, shifts })).toStrictEqual(before);
    expect(Object.isFrozen(worked)).toBe(false);
  });
});

describe("weeklyNorm", () => {
  const FULL: Fte = { numerator: 1, denominator: 1 };
  const THREE_QUARTERS: Fte = { numerator: 3, denominator: 4 };
  const HALF: Fte = { numerator: 1, denominator: 2 };
  const THREE_SEVENTHS: Fte = { numerator: 3, denominator: 7 };

  const HOLIDAY_WEEK = ["2026-11-11"];
  const CHRISTMAS_2025 = ["2025-12-24", "2025-12-25", "2025-12-26"];
  const CHRISTMAS_2024 = ["2024-12-25", "2024-12-26"];

  it.each<{
    label: string;
    startDate: string;
    fte: Fte;
    base: number;
    holidays: string[];
    minutes: number;
    shown: string;
  }>([
    {
      label: "a week with no holiday, full time",
      startDate: "2026-11-02",
      fte: FULL,
      base: 2400,
      holidays: [],
      minutes: 2400,
      shown: "40 h",
    },
    {
      label: "a week with no holiday, 3/4",
      startDate: "2026-11-02",
      fte: THREE_QUARTERS,
      base: 2400,
      holidays: [],
      minutes: 1800,
      shown: "30 h",
    },
    {
      label: "a week with no holiday, 1/2",
      startDate: "2026-11-02",
      fte: HALF,
      base: 2400,
      holidays: [],
      minutes: 1200,
      shown: "20 h",
    },
    {
      label: "a week with no holiday, 3/7 (1028.57 minutes)",
      startDate: "2026-11-02",
      fte: THREE_SEVENTHS,
      base: 2400,
      holidays: [],
      minutes: 1029,
      shown: "17 h 9 min",
    },
    {
      label: "the week of Tuesday 10 November with 11 November, full time",
      startDate: "2026-11-10",
      fte: FULL,
      base: 1920,
      holidays: HOLIDAY_WEEK,
      minutes: 1920,
      shown: "32 h",
    },
    {
      label: "the week of 10 November, 3/4",
      startDate: "2026-11-10",
      fte: THREE_QUARTERS,
      base: 1920,
      holidays: HOLIDAY_WEEK,
      minutes: 1440,
      shown: "24 h",
    },
    {
      label: "the week of 10 November, 1/2",
      startDate: "2026-11-10",
      fte: HALF,
      base: 1920,
      holidays: HOLIDAY_WEEK,
      minutes: 960,
      shown: "16 h",
    },
    {
      label: "the week of 10 November, 3/7 (822.86 minutes)",
      startDate: "2026-11-10",
      fte: THREE_SEVENTHS,
      base: 1920,
      holidays: HOLIDAY_WEEK,
      minutes: 823,
      shown: "13 h 43 min",
    },
    {
      label: "a week with 3 May on a Sunday, which changes nothing",
      startDate: "2026-05-02",
      fte: FULL,
      base: 2400,
      holidays: [],
      minutes: 2400,
      shown: "40 h",
    },
    {
      label: "a week with 1 November on a Sunday, which changes nothing",
      startDate: "2026-11-01",
      fte: FULL,
      base: 2400,
      holidays: [],
      minutes: 2400,
      shown: "40 h",
    },
    {
      label: "the week of 24 December 2025, with 24, 25 and 26 December",
      startDate: "2025-12-22",
      fte: FULL,
      base: 960,
      holidays: CHRISTMAS_2025,
      minutes: 960,
      shown: "16 h",
    },
    {
      label: "the same week at 1/2",
      startDate: "2025-12-22",
      fte: HALF,
      base: 960,
      holidays: CHRISTMAS_2025,
      minutes: 480,
      shown: "8 h",
    },
    {
      label: "the week of 24 December 2024, when it is no holiday yet",
      startDate: "2024-12-23",
      fte: FULL,
      base: 1440,
      holidays: CHRISTMAS_2024,
      minutes: 1440,
      shown: "24 h",
    },
  ])("sets the norm of $label to $shown", ({ startDate, fte, base, holidays, minutes, shown }) => {
    const norm = weeklyNorm(startDate, fte);

    expect(norm).toStrictEqual({ baseMinutes: base, fte, holidays });
    expect(normMinutes(norm)).toBe(minutes);
    expect(formatDuration(normMinutes(norm))).toBe(shown);
  });

  it("keeps the FTE as a fraction, so that 3/7 of a week is 1028.57 minutes and not 1029", () => {
    const norm = weeklyNorm("2026-11-02", THREE_SEVENTHS);

    expect((norm.baseMinutes * norm.fte.numerator) / norm.fte.denominator).toBeCloseTo(1028.57, 2);
    expect(normMinutes(norm)).toBe(1029);
  });

  it("gives its own copy of the FTE and the holidays", () => {
    const fte: Fte = { numerator: 3, denominator: 4 };

    const norm = weeklyNorm("2026-11-10", fte);
    norm.fte.numerator = 1;
    norm.holidays.length = 0;

    expect(fte).toStrictEqual({ numerator: 3, denominator: 4 });
    expect(weeklyNorm("2026-11-10", fte).holidays).toStrictEqual(HOLIDAY_WEEK);
  });

  it("leaves a frozen FTE unchanged", () => {
    const fte = Object.freeze({ numerator: 3, denominator: 4 });

    expect(weeklyNorm("2026-11-10", fte).fte).toStrictEqual({ numerator: 3, denominator: 4 });
    expect(fte).toStrictEqual({ numerator: 3, denominator: 4 });
  });

  it.each(["", "2026-02-30", "2019-12-31", "2100-01-01", "2026-11-10 "])(
    "throws a RangeError for the start date %j",
    (startDate) => {
      expect(() => weeklyNorm(startDate, FULL)).toThrow(RangeError);
    },
  );

  it.each<[string, Fte]>([
    ["a zero numerator", { numerator: 0, denominator: 2 }],
    ["a numerator above the denominator", { numerator: 3, denominator: 2 }],
    ["a zero denominator", { numerator: 1, denominator: 0 }],
    ["a negative numerator", { numerator: -1, denominator: 2 }],
    ["a numerator with a fraction", { numerator: 1.5, denominator: 2 }],
    ["a numerator that is NaN", { numerator: NaN, denominator: 2 }],
    ["a denominator that is infinite", { numerator: 1, denominator: Infinity }],
  ])("throws a RangeError for %s", (_label, fte) => {
    expect(() => weeklyNorm("2026-11-10", fte)).toThrow(RangeError);
  });
});

describe("weeklyNormWithHolidays", () => {
  const FRACTIONS: Fte[] = [
    { numerator: 1, denominator: 1 },
    { numerator: 3, denominator: 4 },
    { numerator: 1, denominator: 7 },
    { numerator: 3, denominator: 7 },
  ];
  // Weeks with none, one, two and three holidays, a Sunday holiday and the turn of the year.
  const START_DATES = ["2026-11-02", "2026-11-10", "2026-05-02", "2024-12-23", "2025-12-22", "2099-12-31"];

  it("gives the same norm as weeklyNorm from the holidays of the week, for every FTE and every kind of week", () => {
    for (const startDate of START_DATES) {
      const holidays = holidaysInWeek(startDate);
      for (const fte of FRACTIONS) {
        expect(weeklyNormWithHolidays(holidays, fte), `${startDate} ${fte.numerator}/${fte.denominator}`).toStrictEqual(
          weeklyNorm(startDate, fte),
        );
      }
    }
  });

  it("gives each norm its own copy of the holidays, so that the norms of one week do not share them", () => {
    const holidays = Object.freeze(["2026-11-11"]);

    const first = weeklyNormWithHolidays(holidays, { numerator: 3, denominator: 4 });
    const second = weeklyNormWithHolidays(holidays, { numerator: 1, denominator: 2 });
    first.holidays.length = 0;

    expect(second.holidays).toStrictEqual(["2026-11-11"]);
    expect(holidays).toStrictEqual(["2026-11-11"]);
    expect(first.holidays).not.toBe(second.holidays);
  });

  it("takes 8 h off the full week for each holiday it is given, and leaves the FTE as a fraction", () => {
    const norm = weeklyNormWithHolidays(["2026-12-24", "2026-12-25", "2026-12-26"], { numerator: 3, denominator: 7 });

    expect(norm).toStrictEqual({
      baseMinutes: 960,
      fte: { numerator: 3, denominator: 7 },
      holidays: ["2026-12-24", "2026-12-25", "2026-12-26"],
    });
    expect(normMinutes(norm)).toBe(411);
  });

  it.each<[string, Fte]>([
    ["a zero numerator", { numerator: 0, denominator: 2 }],
    ["a numerator above the denominator", { numerator: 3, denominator: 2 }],
    ["a numerator with a fraction", { numerator: 1.5, denominator: 2 }],
    ["a denominator that is infinite", { numerator: 1, denominator: Infinity }],
  ])("throws a RangeError for %s", (_label, fte) => {
    expect(() => weeklyNormWithHolidays([], fte)).toThrow(RangeError);
  });
});

describe("weeklyNormExcused", () => {
  const FULL: Fte = { numerator: 1, denominator: 1 };
  const THREE_QUARTERS: Fte = { numerator: 3, denominator: 4 };
  const HALF: Fte = { numerator: 1, denominator: 2 };
  const THREE_SEVENTHS: Fte = { numerator: 3, denominator: 7 };

  // The week of Monday 2 November 2026 has no holiday. The week of Tuesday 10 November has 11 November (a Wednesday) in it,
  // so its working days are Tuesday 10, Wednesday 11 (the holiday), Thursday 12, Friday 13 and Monday 16.
  const HOLIDAY_WEEK = ["2026-11-11"];
  const MONDAY_TO_FRIDAY = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  const WHOLE_WEEK = [...MONDAY_TO_FRIDAY, "2026-11-07", "2026-11-08"];
  const OTHER_DAYS_OF_HOLIDAY_WEEK = ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-16"];

  it.each<{
    label: string;
    holidays: string[];
    excused: string[];
    fte: Fte;
    base: number;
    minutes: number;
    shown: string;
  }>([
    { label: "no absence, full time", holidays: [], excused: [], fte: FULL, base: 2400, minutes: 2400, shown: "40 h" },
    {
      label: "one day of absence, full time",
      holidays: [],
      excused: ["2026-11-04"],
      fte: FULL,
      base: 1920,
      minutes: 1920,
      shown: "32 h",
    },
    {
      label: "two days of absence, full time",
      holidays: [],
      excused: ["2026-11-03", "2026-11-04"],
      fte: FULL,
      base: 1440,
      minutes: 1440,
      shown: "24 h",
    },
    {
      label: "five days of absence, Monday to Friday, full time",
      holidays: [],
      excused: MONDAY_TO_FRIDAY,
      fte: FULL,
      base: 0,
      minutes: 0,
      shown: "0 min",
    },
    {
      label: "seven days of absence given, Saturday and Sunday too, which stops at 0 and does not go below",
      holidays: [],
      excused: WHOLE_WEEK,
      fte: FULL,
      base: 0,
      minutes: 0,
      shown: "0 min",
    },
    {
      label: "the week of 10 November with no absence, full time",
      holidays: HOLIDAY_WEEK,
      excused: [],
      fte: FULL,
      base: 1920,
      minutes: 1920,
      shown: "32 h",
    },
    {
      label: "the week of 10 November with an absence on Thursday 12 November, full time",
      holidays: HOLIDAY_WEEK,
      excused: ["2026-11-12"],
      fte: FULL,
      base: 1440,
      minutes: 1440,
      shown: "24 h",
    },
    {
      label: "the week of 10 November with an absence on Thursday and Friday, full time",
      holidays: HOLIDAY_WEEK,
      excused: ["2026-11-12", "2026-11-13"],
      fte: FULL,
      base: 960,
      minutes: 960,
      shown: "16 h",
    },
    {
      label: "the week of 10 November with an absence on every other working day, full time",
      holidays: HOLIDAY_WEEK,
      excused: OTHER_DAYS_OF_HOLIDAY_WEEK,
      fte: FULL,
      base: 0,
      minutes: 0,
      shown: "0 min",
    },
    {
      label: "the week of 10 November with five days of absence given, which is below 0 before the floor",
      holidays: HOLIDAY_WEEK,
      excused: [...OTHER_DAYS_OF_HOLIDAY_WEEK, "2026-11-11"],
      fte: FULL,
      base: 0,
      minutes: 0,
      shown: "0 min",
    },
    {
      label: "one day of absence, 3/4",
      holidays: [],
      excused: ["2026-11-04"],
      fte: THREE_QUARTERS,
      base: 1920,
      minutes: 1440,
      shown: "24 h",
    },
    {
      label: "one day of absence, 1/2",
      holidays: [],
      excused: ["2026-11-04"],
      fte: HALF,
      base: 1920,
      minutes: 960,
      shown: "16 h",
    },
    {
      label: "one day of absence, 3/7 (822.86 minutes)",
      holidays: [],
      excused: ["2026-11-04"],
      fte: THREE_SEVENTHS,
      base: 1920,
      minutes: 823,
      shown: "13 h 43 min",
    },
    {
      label: "the week of 10 November with one day of absence, 3/4",
      holidays: HOLIDAY_WEEK,
      excused: ["2026-11-12"],
      fte: THREE_QUARTERS,
      base: 1440,
      minutes: 1080,
      shown: "18 h",
    },
    {
      label: "the week of 10 November with one day of absence, 1/2",
      holidays: HOLIDAY_WEEK,
      excused: ["2026-11-12"],
      fte: HALF,
      base: 1440,
      minutes: 720,
      shown: "12 h",
    },
    {
      label: "the week of 10 November with one day of absence, 3/7 (617.14 minutes)",
      holidays: HOLIDAY_WEEK,
      excused: ["2026-11-12"],
      fte: THREE_SEVENTHS,
      base: 1440,
      minutes: 617,
      shown: "10 h 17 min",
    },
    {
      label: "five days of absence, 3/4",
      holidays: [],
      excused: MONDAY_TO_FRIDAY,
      fte: THREE_QUARTERS,
      base: 0,
      minutes: 0,
      shown: "0 min",
    },
  ])("sets the norm of $label to $shown", ({ holidays, excused, fte, base, minutes, shown }) => {
    const norm = weeklyNormExcused(holidays, excused, fte);

    expect(norm).toStrictEqual({ baseMinutes: base, fte, holidays, excusedDays: excused });
    expect(normMinutes(norm)).toBe(minutes);
    expect(formatDuration(normMinutes(norm))).toBe(shown);
  });

  it("takes 8 h off the full week for each holiday and for each day of absence, and never goes below 0", () => {
    for (let holidayCount = 0; holidayCount <= 3; holidayCount++) {
      for (let excusedCount = 0; excusedCount <= 8; excusedCount++) {
        const holidays = Array.from({ length: holidayCount }, (_unused, index) => `2026-12-2${index + 4}`);
        const excused = Array.from({ length: excusedCount }, (_unused, index) => `2026-11-0${index + 1}`);

        const { baseMinutes } = weeklyNormExcused(holidays, excused, FULL);

        expect(baseMinutes, `${holidayCount} holidays and ${excusedCount} days of absence`).toBe(
          Math.max(0, 2400 - 480 * (holidayCount + excusedCount)),
        );
      }
    }
  });

  it("gives exactly what weeklyNormWithHolidays gives, apart from the empty list of days of absence, when nobody is away", () => {
    const fractions: Fte[] = [FULL, THREE_QUARTERS, { numerator: 1, denominator: 7 }, THREE_SEVENTHS];
    // Weeks with none, one, two and three holidays, a Sunday holiday and the turn of the year.
    const startDates = ["2026-11-02", "2026-11-10", "2026-05-02", "2024-12-23", "2025-12-22", "2099-12-31"];

    for (const startDate of startDates) {
      const holidays = holidaysInWeek(startDate);
      for (const fte of fractions) {
        const { excusedDays, ...norm } = weeklyNormExcused(holidays, [], fte);

        expect(excusedDays).toStrictEqual([]);
        expect(norm, `${startDate} ${fte.numerator}/${fte.denominator}`).toStrictEqual(
          weeklyNormWithHolidays(holidays, fte),
        );
        expect(norm).toStrictEqual(weeklyNorm(startDate, fte));
      }
    }
  });

  it("leaves weeklyNorm and weeklyNormWithHolidays without the list of days of absence", () => {
    expect(Object.keys(weeklyNorm("2026-11-10", FULL)).sort()).toStrictEqual(["baseMinutes", "fte", "holidays"]);
    expect(Object.keys(weeklyNormWithHolidays(HOLIDAY_WEEK, FULL)).sort()).toStrictEqual([
      "baseMinutes",
      "fte",
      "holidays",
    ]);
  });

  it("keeps the FTE as a fraction, so that a norm lowered by an absence is compared without rounding", () => {
    const norm = weeklyNormExcused([], ["2026-11-04"], THREE_SEVENTHS);

    expect((norm.baseMinutes * norm.fte.numerator) / norm.fte.denominator).toBeCloseTo(822.86, 2);
    expect(normMinutes(norm)).toBe(823);
  });

  it("gives its own copy of the FTE and of both lists, and leaves frozen input unchanged", () => {
    const fte = Object.freeze({ numerator: 3, denominator: 4 });
    const holidays = Object.freeze([...HOLIDAY_WEEK]);
    const excused = Object.freeze(["2026-11-12", "2026-11-13"]);

    const first = weeklyNormExcused(holidays, excused, fte);
    const second = weeklyNormExcused(holidays, excused, fte);
    first.fte.numerator = 1;
    first.holidays.length = 0;
    first.excusedDays.length = 0;

    expect(second).toStrictEqual({
      baseMinutes: 960,
      fte: { numerator: 3, denominator: 4 },
      holidays: ["2026-11-11"],
      excusedDays: ["2026-11-12", "2026-11-13"],
    });
    expect(second.holidays).not.toBe(first.holidays);
    expect(second.excusedDays).not.toBe(first.excusedDays);
    expect(fte).toStrictEqual({ numerator: 3, denominator: 4 });
    expect(holidays).toStrictEqual(["2026-11-11"]);
    expect(excused).toStrictEqual(["2026-11-12", "2026-11-13"]);
  });

  it.each<[string, Fte]>([
    ["a zero numerator", { numerator: 0, denominator: 2 }],
    ["a numerator above the denominator", { numerator: 3, denominator: 2 }],
    ["a zero denominator", { numerator: 1, denominator: 0 }],
    ["a negative numerator", { numerator: -1, denominator: 2 }],
    ["a numerator with a fraction", { numerator: 1.5, denominator: 2 }],
    ["a numerator that is NaN", { numerator: NaN, denominator: 2 }],
    ["a denominator that is infinite", { numerator: 1, denominator: Infinity }],
  ])("throws a RangeError for %s, with or without days of absence", (_label, fte) => {
    expect(() => weeklyNormExcused([], [], fte)).toThrow(RangeError);
    expect(() => weeklyNormExcused(HOLIDAY_WEEK, ["2026-11-12"], fte)).toThrow(RangeError);
  });

  it("gives the same norm for repeated calls", () => {
    const norm = expectDeterministic(
      (input: { holidays: string[]; excused: string[] }) =>
        weeklyNormExcused(input.holidays, input.excused, THREE_QUARTERS),
      { holidays: HOLIDAY_WEEK, excused: ["2026-11-12"] },
    );

    expect(norm).toStrictEqual({
      baseMinutes: 1440,
      fte: { numerator: 3, denominator: 4 },
      holidays: ["2026-11-11"],
      excusedDays: ["2026-11-12"],
    });
  });
});

describe("the norm of a week from the absences", () => {
  const FULL: Fte = { numerator: 1, denominator: 1 };
  const THREE_QUARTERS: Fte = { numerator: 3, denominator: 4 };
  const MONDAY_TO_FRIDAY_OF_NOVEMBER = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

  interface Away {
    startDate: string;
    endDate: string;
    status: AbsenceStatus;
  }

  const approved = (startDate: string, endDate: string): Away => ({ startDate, endDate, status: "approved" });

  // The norm the way the rules and the hours column build it: the holidays of the week, then the days of approved absence.
  function normOfWeek(startDate: string, absences: readonly Away[], fte: Fte) {
    const holidays = holidaysInWeek(startDate);
    return weeklyNormExcused(holidays, excusedWeekdays(startDate, absences, holidays), fte);
  }

  it.each<{ label: string; startDate: string; absences: Away[]; excused: string[]; hours: string }>([
    {
      label: "no absence in the week of 2 November",
      startDate: "2026-11-02",
      absences: [],
      excused: [],
      hours: "40 h",
    },
    {
      label: "one Wednesday",
      startDate: "2026-11-02",
      absences: [approved("2026-11-04", "2026-11-04")],
      excused: ["2026-11-04"],
      hours: "32 h",
    },
    {
      label: "Monday to Friday",
      startDate: "2026-11-02",
      absences: [approved("2026-11-02", "2026-11-06")],
      excused: MONDAY_TO_FRIDAY_OF_NOVEMBER,
      hours: "0 min",
    },
    {
      label: "all seven days, of which only Monday to Friday count",
      startDate: "2026-11-02",
      absences: [approved("2026-11-02", "2026-11-08")],
      excused: MONDAY_TO_FRIDAY_OF_NOVEMBER,
      hours: "0 min",
    },
    {
      label: "Saturday and Sunday only, which changes nothing",
      startDate: "2026-11-02",
      absences: [approved("2026-11-07", "2026-11-08")],
      excused: [],
      hours: "40 h",
    },
    {
      label: "Thursday 12 November in the week of the 11 November holiday",
      startDate: "2026-11-10",
      absences: [approved("2026-11-12", "2026-11-12")],
      excused: ["2026-11-12"],
      hours: "24 h",
    },
    {
      label: "the holiday only, which does not lower the norm a second time",
      startDate: "2026-11-10",
      absences: [approved("2026-11-11", "2026-11-11")],
      excused: [],
      hours: "32 h",
    },
    {
      label: "an absence from the holiday to Friday, in which the holiday is not counted again",
      startDate: "2026-11-10",
      absences: [approved("2026-11-11", "2026-11-13")],
      excused: ["2026-11-12", "2026-11-13"],
      hours: "16 h",
    },
    {
      label: "the whole week of the holiday",
      startDate: "2026-11-10",
      absences: [approved("2026-11-10", "2026-11-16")],
      excused: ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-16"],
      hours: "0 min",
    },
    {
      label: "a requested and a rejected absence, which lower nothing",
      startDate: "2026-11-10",
      absences: [
        { startDate: "2026-11-12", endDate: "2026-11-13", status: "requested" },
        { startDate: "2026-11-10", endDate: "2026-11-16", status: "rejected" },
      ],
      excused: [],
      hours: "32 h",
    },
  ])("gives $hours for $label", ({ startDate, absences, excused, hours }) => {
    const norm = normOfWeek(startDate, absences, FULL);

    expect(norm.excusedDays).toStrictEqual(excused);
    expect(formatDuration(normMinutes(norm))).toBe(hours);
  });

  it("compares the work of 3/4 with the lowered norm exactly", () => {
    // 2400 - 480 (the holiday) - 480 (Thursday 12 November) = 1440, and 3/4 of it is 1080 minutes, which is 18 h.
    const norm = normOfWeek("2026-11-10", [approved("2026-11-12", "2026-11-12")], THREE_QUARTERS);

    expect(norm.baseMinutes).toBe(1440);
    expect(normMinutes(norm)).toBe(1080);
    expect(exceedsNorm(1080, norm)).toBe(false);
    expect(exceedsNorm(1081, norm)).toBe(true);
  });
});

describe("exceedsNorm", () => {
  const normOf = (startDate: string, numerator: number, denominator: number) =>
    weeklyNorm(startDate, { numerator, denominator });

  it.each<{ label: string; norm: WeeklyNorm; worked: number; exceeds: boolean }>([
    { label: "nothing worked", norm: normOf("2026-11-02", 1, 1), worked: 0, exceeds: false },
    { label: "a minute below the norm of 40 h", norm: normOf("2026-11-02", 1, 1), worked: 2399, exceeds: false },
    { label: "exactly the norm of 40 h", norm: normOf("2026-11-02", 1, 1), worked: 2400, exceeds: false },
    { label: "a minute above the norm of 40 h", norm: normOf("2026-11-02", 1, 1), worked: 2401, exceeds: true },
    { label: "exactly the norm of 30 h (3/4)", norm: normOf("2026-11-02", 3, 4), worked: 1800, exceeds: false },
    { label: "a minute above the norm of 30 h (3/4)", norm: normOf("2026-11-02", 3, 4), worked: 1801, exceeds: true },
    { label: "exactly the norm of 20 h (1/2)", norm: normOf("2026-11-02", 1, 2), worked: 1200, exceeds: false },
    { label: "a minute above the norm of 20 h (1/2)", norm: normOf("2026-11-02", 1, 2), worked: 1201, exceeds: true },
    {
      label: "exactly the norm of 32 h in a week with a holiday",
      norm: normOf("2026-11-10", 1, 1),
      worked: 1920,
      exceeds: false,
    },
    {
      label: "a minute above the norm of 32 h in a week with a holiday",
      norm: normOf("2026-11-10", 1, 1),
      worked: 1921,
      exceeds: true,
    },
    { label: "exactly 40 h in the week with a holiday", norm: normOf("2026-11-10", 1, 1), worked: 2400, exceeds: true },
    {
      label: "exactly the norm of 16 h (1/2) in a week with a holiday",
      norm: normOf("2026-11-10", 1, 2),
      worked: 960,
      exceeds: false,
    },
    {
      label: "a minute above the norm of 16 h (1/2) in a week with a holiday",
      norm: normOf("2026-11-10", 1, 2),
      worked: 961,
      exceeds: true,
    },
    {
      label: "1028 minutes of the norm of 3/7 (1028.57 minutes)",
      norm: normOf("2026-11-02", 3, 7),
      worked: 1028,
      exceeds: false,
    },
    {
      label: "1029 minutes of the norm of 3/7, the rounded norm that is above the exact one",
      norm: normOf("2026-11-02", 3, 7),
      worked: 1029,
      exceeds: true,
    },
    {
      label: "822 minutes of the norm of 3/7 in a week with a holiday (822.86 minutes)",
      norm: normOf("2026-11-10", 3, 7),
      worked: 822,
      exceeds: false,
    },
    {
      label: "823 minutes of the norm of 3/7 in a week with a holiday",
      norm: normOf("2026-11-10", 3, 7),
      worked: 823,
      exceeds: true,
    },
    {
      label: "1714 minutes of the norm of 5/7 (1714.29 minutes), the rounded norm that is below the exact one",
      norm: normOf("2026-11-02", 5, 7),
      worked: 1714,
      exceeds: false,
    },
    { label: "1715 minutes of the norm of 5/7", norm: normOf("2026-11-02", 5, 7), worked: 1715, exceeds: true },
  ])("says $exceeds for $label", ({ norm: weekNorm, worked, exceeds }) => {
    expect(exceedsNorm(worked, weekNorm)).toBe(exceeds);
  });

  it("flips at the first whole minute above the exact norm, for every FTE and every kind of week", () => {
    const fractions: [number, number][] = [
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 8],
      [3, 7],
      [7, 10],
    ];
    // Weeks with none, one, two and three holidays.
    const startDates = ["2026-11-02", "2026-11-10", "2024-12-23", "2025-12-22"];

    for (const startDate of startDates) {
      for (const [numerator, denominator] of fractions) {
        const week = normOf(startDate, numerator, denominator);
        const firstAbove = Math.floor((week.baseMinutes * numerator) / denominator) + 1;

        expect(exceedsNorm(firstAbove - 1, week), `${startDate} ${numerator}/${denominator}: ${firstAbove - 1}`).toBe(
          false,
        );
        expect(exceedsNorm(firstAbove, week), `${startDate} ${numerator}/${denominator}: ${firstAbove}`).toBe(true);
      }
    }
  });

  describe("with the days of absence taken off", () => {
    const excusedNorm = (holidays: string[], excused: string[], numerator: number, denominator: number) =>
      weeklyNormExcused(holidays, excused, { numerator, denominator });
    const HOLIDAY = ["2026-11-11"];
    const THURSDAY = ["2026-11-12"];

    it.each<{ label: string; norm: WeeklyNorm; worked: number; exceeds: boolean }>([
      { label: "1920 minutes of 32 h", norm: excusedNorm([], THURSDAY, 1, 1), worked: 1920, exceeds: false },
      { label: "1921 minutes of 32 h", norm: excusedNorm([], THURSDAY, 1, 1), worked: 1921, exceeds: true },
      { label: "1440 minutes of 3/4 of 32 h", norm: excusedNorm([], THURSDAY, 3, 4), worked: 1440, exceeds: false },
      { label: "1441 minutes of 3/4 of 32 h", norm: excusedNorm([], THURSDAY, 3, 4), worked: 1441, exceeds: true },
      { label: "960 minutes of 1/2 of 32 h", norm: excusedNorm([], THURSDAY, 1, 2), worked: 960, exceeds: false },
      { label: "961 minutes of 1/2 of 32 h", norm: excusedNorm([], THURSDAY, 1, 2), worked: 961, exceeds: true },
      {
        label: "822 minutes of 3/7 of 32 h (822.86 minutes)",
        norm: excusedNorm([], THURSDAY, 3, 7),
        worked: 822,
        exceeds: false,
      },
      {
        label: "823 minutes of 3/7 of 32 h, the rounded norm that is above the exact one",
        norm: excusedNorm([], THURSDAY, 3, 7),
        worked: 823,
        exceeds: true,
      },
      {
        label: "617 minutes of 3/7 of 24 h, a holiday and an absence (617.14 minutes)",
        norm: excusedNorm(HOLIDAY, THURSDAY, 3, 7),
        worked: 617,
        exceeds: false,
      },
      {
        label: "618 minutes of 3/7 of 24 h, a holiday and an absence",
        norm: excusedNorm(HOLIDAY, THURSDAY, 3, 7),
        worked: 618,
        exceeds: true,
      },
      {
        label: "1080 minutes of 3/4 of 24 h, a holiday and an absence",
        norm: excusedNorm(HOLIDAY, THURSDAY, 3, 4),
        worked: 1080,
        exceeds: false,
      },
      {
        label: "1081 minutes of 3/4 of 24 h, a holiday and an absence",
        norm: excusedNorm(HOLIDAY, THURSDAY, 3, 4),
        worked: 1081,
        exceeds: true,
      },
      {
        label: "nothing worked in a week that an absence has taken to 0",
        norm: excusedNorm([], ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], 1, 1),
        worked: 0,
        exceeds: false,
      },
      {
        label: "a single minute worked in a week that an absence has taken to 0",
        norm: excusedNorm([], ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], 1, 1),
        worked: 1,
        exceeds: true,
      },
      {
        label: "a single minute worked at 3/7 in a week that an absence has taken to 0",
        norm: excusedNorm([], ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], 3, 7),
        worked: 1,
        exceeds: true,
      },
    ])("says $exceeds for $label", ({ norm, worked, exceeds }) => {
      expect(exceedsNorm(worked, norm)).toBe(exceeds);
    });

    it("flips at the first whole minute above the exact norm, for every FTE and every number of days of absence", () => {
      const fractions: [number, number][] = [
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 8],
        [3, 7],
        [7, 10],
      ];
      const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];

      for (const holidays of [[], HOLIDAY]) {
        for (let count = 0; count <= days.length; count++) {
          for (const [numerator, denominator] of fractions) {
            const week = excusedNorm(holidays, days.slice(0, count), numerator, denominator);
            const firstAbove = Math.floor((week.baseMinutes * numerator) / denominator) + 1;
            const label = `${holidays.length} holidays, ${count} days of absence, ${numerator}/${denominator}`;

            expect(exceedsNorm(firstAbove - 1, week), `${label}: ${firstAbove - 1}`).toBe(false);
            expect(exceedsNorm(firstAbove, week), `${label}: ${firstAbove}`).toBe(true);
          }
        }
      }
    });
  });

  it("leaves the norm unchanged", () => {
    const week = Object.freeze(normOf("2026-11-10", 3, 4));
    const before = structuredClone(week);

    exceedsNorm(1440, week);
    normMinutes(week);

    expect(structuredClone(week)).toStrictEqual(before);
  });
});

describe("repeatability of the work hours", () => {
  const people = [ANNA, BARTEK, CEZARY];
  const days = Array.from({ length: 7 }, (_unused, dayOffset) => dayOffset);
  const durationOf: Record<string, number> = { [MORNING]: 480, [NIGHT]: 480, [LONG]: 720 };

  // About half of the person, shift and day combinations, in no particular order of shift.
  const placed = SHIFTS.flatMap((shift, shiftIndex) =>
    people.flatMap((employeeId, personIndex) =>
      days
        .filter((dayOffset) => (shiftIndex + personIndex + dayOffset) % 2 === 0)
        .map((dayOffset) => assignment(shift.id, dayOffset, employeeId)),
    ),
  );
  // Repeats and a shift without hours, which must not change the result.
  const roster = [...placed, placed[0], placed[5], assignment(UNKNOWN, 2, ANNA), assignment(UNKNOWN, 0, CEZARY)];
  const seeds = [1, 2, 3, 4, 5, 6];

  it("sums to the same hours for repeated calls and for any order of the assignments and of the shifts", () => {
    const workedOf = (input: { assignments: AssignmentInput[]; shifts: ShiftTimes[] }) =>
      workedMinutesByEmployee(input.assignments, input.shifts);

    const worked = expectDeterministic(
      workedOf,
      { assignments: roster, shifts: SHIFTS },
      {
        variants: seeds.map((seed) => ({
          assignments: seededShuffle(roster, seed),
          shifts: seededShuffle(SHIFTS, seed + 100),
        })),
      },
    );

    const expected = Object.fromEntries(
      people.map((employeeId): [string, number] => [
        employeeId,
        placed
          .filter((entry) => entry.employeeId === employeeId)
          .reduce((total, entry) => total + durationOf[entry.shiftId], 0),
      ]),
    );
    expect(worked).toStrictEqual(expected);
    expect(Object.keys(worked)).toStrictEqual([ANNA, BARTEK, CEZARY]);
    // The roster has enough in it for the check to mean something.
    expect(Object.values(worked).every((minutes) => minutes > 0)).toBe(true);
  });

  it("gives the same interval and norm for repeated calls", () => {
    expect(expectDeterministic((day: number) => shiftInterval(NIGHT_SHIFT, day), 6)).toStrictEqual({
      start: 9960,
      end: 10440,
    });
    expect(
      expectDeterministic((startDate: string) => weeklyNorm(startDate, { numerator: 3, denominator: 4 }), "2026-11-10"),
    ).toStrictEqual({ baseMinutes: 1920, fte: { numerator: 3, denominator: 4 }, holidays: ["2026-11-11"] });
  });
});

describe("the time zone", () => {
  it("calls no method of Date that reads or writes the local time", () => {
    const called = localDateMethodsCalledBy(() => {
      shiftInterval(NIGHT_SHIFT, 6);
      workedMinutesByEmployee([assignment(NIGHT, 6, ANNA), assignment(MORNING, 0, ANNA)], SHIFTS);
      const week = weeklyNorm("2026-11-10", { numerator: 3, denominator: 4 });
      normMinutes(week);
      exceedsNorm(1441, week);
      weeklyNorm("2099-12-31", { numerator: 1, denominator: 1 });
      weeklyNormWithHolidays(holidaysInWeek("2099-12-31"), { numerator: 1, denominator: 1 });
    });

    expect(called).toStrictEqual([]);
  });

  it("calls no method of Date that reads or writes the local time for the norm lowered by absences", () => {
    const called = localDateMethodsCalledBy(() => {
      const holidays = holidaysInWeek("2026-11-10");
      const excused = excusedWeekdays(
        "2026-11-10",
        [{ startDate: "2026-11-12", endDate: "2026-11-13", status: "approved" }],
        holidays,
      );
      const week = weeklyNormExcused(holidays, excused, { numerator: 3, denominator: 4 });
      normMinutes(week);
      exceedsNorm(1441, week);
      weeklyNormExcused(holidaysInWeek("2099-12-31"), ["2099-12-31"], { numerator: 1, denominator: 1 });
    });

    expect(called).toStrictEqual([]);
  });
});
