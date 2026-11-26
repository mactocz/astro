import { describe, expect, it } from "vitest";
import { formatDuration } from "@/lib/services/shift";
import {
  exceedsNorm,
  normMinutes,
  shiftInterval,
  weeklyNorm,
  workedMinutesByEmployee,
  type ShiftTimes,
  type WeeklyNorm,
} from "@/lib/services/work-hours";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import { localDateMethodsCalledBy } from "@/lib/testing/local-time";
import type { AssignmentInput, Fte } from "@/types";

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
    });

    expect(called).toStrictEqual([]);
  });
});
