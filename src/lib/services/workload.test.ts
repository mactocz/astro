import { describe, expect, it } from "vitest";
import { holidaysInWeek, isHoliday, weekdayOf } from "@/lib/services/calendar";
import { weeklyNormViolations } from "@/lib/services/rules";
import { exceedsNorm, weeklyNorm, type ShiftTimes } from "@/lib/services/work-hours";
import { formatWorkload, summarizeWorkload, type WorkloadInput } from "@/lib/services/workload";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import { localDateMethodsCalledBy } from "@/lib/testing/local-time";
import type { AbsenceOption, AbsenceStatus, AbsenceType, AssignmentInput, Fte, WorkloadRow } from "@/types";

// The shifts are referred to by id only. By id they order as NIGHT, MORNING, LONG, and the employees as ANNA, BARTEK,
// CEZARY, which is not the order of the names, so only a sort by id can produce it.
const NIGHT = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";
const MORNING = "5f1c9a3e-2b7d-4e60-8c14-9a0d3e7b1f25";
const LONG = "a3d7e1f4-6c52-4b98-8e0a-1f9c2d5b7a36";
const UNKNOWN = "00000000-0000-4000-8000-000000000001";
const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const CEZARY = "c0ffee00-1111-4222-8333-444455556666";
// A person that is on no list below, only in the assignments.
const DANUTA = "d4a7e2b1-3c58-4f90-a6e1-7b2c9d0f8e34";

// 06:00-14:00 (8 h), 22:00-06:00 the next day (8 h) and 08:00-20:00 (12 h).
const MORNING_SHIFT: ShiftTimes = { id: MORNING, name: "Poranna", startMinute: 360, endMinute: 840 };
const NIGHT_SHIFT: ShiftTimes = { id: NIGHT, name: "Nocna", startMinute: 1320, endMinute: 360 };
const LONG_SHIFT: ShiftTimes = { id: LONG, name: "Długa", startMinute: 480, endMinute: 1200 };
const SHIFTS = [MORNING_SHIFT, NIGHT_SHIFT, LONG_SHIFT];

// A shift of the given length in minutes (1 to 1079) that starts at 06:00 and ends the same day.
function lasting(minutes: number): ShiftTimes {
  return { id: `lasting-${minutes}`, name: `${minutes} min`, startMinute: 360, endMinute: 360 + minutes };
}

const ONE_MINUTE = lasting(1);
const SEVEN_H_59 = lasting(479);
const TWO_H_30 = lasting(150);
const MIN_1028 = lasting(1028);
const MIN_1029 = lasting(1029);
const MIN_1030 = lasting(1030);
const ALL_SHIFTS = [...SHIFTS, ONE_MINUTE, SEVEN_H_59, TWO_H_30, MIN_1028, MIN_1029, MIN_1030];

const FULL: Fte = { numerator: 1, denominator: 1 };
const THREE_QUARTERS: Fte = { numerator: 3, denominator: 4 };
const HALF: Fte = { numerator: 1, denominator: 2 };
const THREE_SEVENTHS: Fte = { numerator: 3, denominator: 7 };

// Monday 2 November 2026: no holiday in the week. Tuesday 10 November 2026: Wednesday 11 November is a holiday in the week.
// Sunday 1 November 2026 (All Saints) is a holiday on a Sunday, the only one in its week.
const PLAIN_WEEK = "2026-11-02";
const HOLIDAY_WEEK = "2026-11-10";
const SUNDAY_HOLIDAY_WEEK = "2026-11-01";

function assignment(shiftId: string, dayOffset: number, employeeId: string): AssignmentInput {
  return { shiftId, dayOffset, employeeId };
}

// The same shift on each of the given days.
function onDays(shiftId: string, days: readonly number[], employeeId: string): AssignmentInput[] {
  return days.map((dayOffset) => assignment(shiftId, dayOffset, employeeId));
}

function summarize(
  employees: WorkloadInput["employees"],
  assignments: readonly AssignmentInput[] = [],
  startDate = PLAIN_WEEK,
  absences?: readonly AbsenceOption[],
): WorkloadRow[] {
  return summarizeWorkload({ startDate, assignments, shifts: ALL_SHIFTS, employees, absences });
}

// An absence of the given kind, `approved` unless the status says otherwise.
function absence(
  startDate: string,
  endDate: string,
  employeeId: string = ANNA,
  type: AbsenceType = "vacation",
  status: AbsenceStatus = "approved",
): AbsenceOption {
  return { employeeId, type, status, startDate, endDate };
}

describe("the weeks the tests use", () => {
  it("are the weeks they are named for", () => {
    // Tuesday 10 November, with the holiday on the Wednesday, which takes 8 h off the norm.
    expect(weekdayOf(HOLIDAY_WEEK)).toBe(2);
    expect(weekdayOf("2026-11-11")).toBe(3);
    expect(holidaysInWeek(HOLIDAY_WEEK)).toStrictEqual(["2026-11-11"]);
    // 1 November 2026 is a holiday and a Sunday, so it takes nothing off the norm.
    expect(isHoliday(SUNDAY_HOLIDAY_WEEK)).toBe(true);
    expect(weekdayOf(SUNDAY_HOLIDAY_WEEK)).toBe(0);
    expect(holidaysInWeek(SUNDAY_HOLIDAY_WEEK)).toStrictEqual([]);
    expect(holidaysInWeek(PLAIN_WEEK)).toStrictEqual([]);
  });
});

describe("summarizeWorkload norm", () => {
  it.each<{ label: string; startDate: string; fte: Fte; norm: number; shown: string }>([
    { label: "full time in a week with no holiday", startDate: PLAIN_WEEK, fte: FULL, norm: 2400, shown: "40 h" },
    { label: "3/4 in a week with no holiday", startDate: PLAIN_WEEK, fte: THREE_QUARTERS, norm: 1800, shown: "30 h" },
    { label: "1/2 in a week with no holiday", startDate: PLAIN_WEEK, fte: HALF, norm: 1200, shown: "20 h" },
    {
      label: "3/7 in a week with no holiday (1028.57 minutes)",
      startDate: PLAIN_WEEK,
      fte: THREE_SEVENTHS,
      norm: 1029,
      shown: "17 h 9 min",
    },
    {
      label: "full time in a week with a holiday on a Wednesday",
      startDate: HOLIDAY_WEEK,
      fte: FULL,
      norm: 1920,
      shown: "32 h",
    },
    {
      label: "3/4 in a week with a holiday on a Wednesday",
      startDate: HOLIDAY_WEEK,
      fte: THREE_QUARTERS,
      norm: 1440,
      shown: "24 h",
    },
    {
      label: "3/7 in a week with a holiday on a Wednesday (822.86 minutes)",
      startDate: HOLIDAY_WEEK,
      fte: THREE_SEVENTHS,
      norm: 823,
      shown: "13 h 43 min",
    },
    {
      label: "full time in a week whose only holiday is on a Sunday",
      startDate: SUNDAY_HOLIDAY_WEEK,
      fte: FULL,
      norm: 2400,
      shown: "40 h",
    },
    {
      label: "1/2 in a week whose only holiday is on a Sunday",
      startDate: SUNDAY_HOLIDAY_WEEK,
      fte: HALF,
      norm: 1200,
      shown: "20 h",
    },
    {
      label: "full time in the week of 24, 25 and 26 December 2025",
      startDate: "2025-12-22",
      fte: FULL,
      norm: 960,
      shown: "16 h",
    },
  ])("gives a person with no shifts 0 min of $shown for $label", ({ startDate, fte, norm, shown }) => {
    const rows = summarize([{ id: ANNA, fte }], [], startDate);

    expect(rows).toStrictEqual([{ employeeId: ANNA, workedMinutes: 0, normMinutes: norm, differenceMinutes: -norm }]);
    expect(formatWorkload(rows[0])).toStrictEqual({ total: `0 min z ${shown}`, difference: `mniej o ${shown}` });
  });

  it("gives each person the norm of their own FTE in the same schedule", () => {
    const rows = summarize(
      [
        { id: ANNA, fte: FULL },
        { id: BARTEK, fte: HALF },
        { id: CEZARY, fte: THREE_SEVENTHS },
      ],
      [],
      HOLIDAY_WEEK,
    );

    expect(rows.map((row) => [row.employeeId, row.normMinutes])).toStrictEqual([
      [ANNA, 1920],
      [BARTEK, 960],
      [CEZARY, 823],
    ]);
  });
});

describe("summarizeWorkload sum and difference", () => {
  const fourMornings = onDays(MORNING, [0, 1, 2, 3], ANNA);
  const fiveMornings = onDays(MORNING, [0, 1, 2, 3, 4], ANNA);

  it.each<{
    label: string;
    startDate?: string;
    fte?: Fte;
    assignments: AssignmentInput[];
    worked: number;
    norm: number;
    difference: number;
    total: string;
    words: string;
  }>([
    {
      label: "a person with no shifts",
      assignments: [],
      worked: 0,
      norm: 2400,
      difference: -2400,
      total: "0 min z 40 h",
      words: "mniej o 40 h",
    },
    {
      label: "four morning shifts of 8 h against 40 h",
      assignments: fourMornings,
      worked: 1920,
      norm: 2400,
      difference: -480,
      total: "32 h z 40 h",
      words: "mniej o 8 h",
    },
    {
      label: "a sum equal to the norm",
      assignments: fiveMornings,
      worked: 2400,
      norm: 2400,
      difference: 0,
      total: "40 h z 40 h",
      words: "równo z normą",
    },
    {
      label: "a sum one minute below the norm",
      assignments: [...fourMornings, assignment(SEVEN_H_59.id, 4, ANNA)],
      worked: 2399,
      norm: 2400,
      difference: -1,
      total: "39 h 59 min z 40 h",
      words: "mniej o 1 min",
    },
    {
      label: "a sum one minute above the norm",
      assignments: [...fiveMornings, assignment(ONE_MINUTE.id, 5, ANNA)],
      worked: 2401,
      norm: 2400,
      difference: 1,
      total: "40 h 1 min z 40 h",
      words: "więcej o 1 min",
    },
    {
      label: "a sum two and a half hours above the norm",
      assignments: [...fiveMornings, assignment(TWO_H_30.id, 5, ANNA)],
      worked: 2550,
      norm: 2400,
      difference: 150,
      total: "42 h 30 min z 40 h",
      words: "więcej o 2 h 30 min",
    },
    {
      label: "a night shift that starts on day 6, counted in full",
      assignments: [assignment(NIGHT, 6, ANNA)],
      worked: 480,
      norm: 2400,
      difference: -1920,
      total: "8 h z 40 h",
      words: "mniej o 32 h",
    },
    {
      label: "a night shift on day 6 and a morning shift on day 0",
      assignments: [assignment(NIGHT, 6, ANNA), assignment(MORNING, 0, ANNA)],
      worked: 960,
      norm: 2400,
      difference: -1440,
      total: "16 h z 40 h",
      words: "mniej o 24 h",
    },
    {
      label: "two shifts on one day",
      assignments: [assignment(MORNING, 1, ANNA), assignment(LONG, 1, ANNA)],
      worked: 1200,
      norm: 2400,
      difference: -1200,
      total: "20 h z 40 h",
      words: "mniej o 20 h",
    },
    {
      label: "the same assignment twice, which counts once",
      assignments: [assignment(MORNING, 0, ANNA), assignment(MORNING, 0, ANNA)],
      worked: 480,
      norm: 2400,
      difference: -1920,
      total: "8 h z 40 h",
      words: "mniej o 32 h",
    },
    {
      label: "an unknown shift next to a known one, which has no hours",
      assignments: [assignment(MORNING, 0, ANNA), assignment(UNKNOWN, 1, ANNA)],
      worked: 480,
      norm: 2400,
      difference: -1920,
      total: "8 h z 40 h",
      words: "mniej o 32 h",
    },
    {
      label: "nothing but an unknown shift",
      assignments: [assignment(UNKNOWN, 0, ANNA)],
      worked: 0,
      norm: 2400,
      difference: -2400,
      total: "0 min z 40 h",
      words: "mniej o 40 h",
    },
    {
      label: "four morning shifts in the week with a holiday on a Wednesday, equal to its norm of 32 h",
      startDate: HOLIDAY_WEEK,
      assignments: fourMornings,
      worked: 1920,
      norm: 1920,
      difference: 0,
      total: "32 h z 32 h",
      words: "równo z normą",
    },
    {
      label: "five morning shifts in the week with a holiday on a Wednesday, above its norm of 32 h",
      startDate: HOLIDAY_WEEK,
      assignments: fiveMornings,
      worked: 2400,
      norm: 1920,
      difference: 480,
      total: "40 h z 32 h",
      words: "więcej o 8 h",
    },
    {
      label: "five morning shifts in the week whose only holiday is on a Sunday, equal to the norm of 40 h",
      startDate: SUNDAY_HOLIDAY_WEEK,
      assignments: fiveMornings,
      worked: 2400,
      norm: 2400,
      difference: 0,
      total: "40 h z 40 h",
      words: "równo z normą",
    },
    {
      label: "one morning shift at 1/2 of an FTE",
      fte: HALF,
      assignments: [assignment(MORNING, 0, ANNA)],
      worked: 480,
      norm: 1200,
      difference: -720,
      total: "8 h z 20 h",
      words: "mniej o 12 h",
    },
    {
      label: "a long and a morning shift at 1/2 of an FTE, equal to the norm of 20 h",
      fte: HALF,
      assignments: [assignment(LONG, 0, ANNA), assignment(MORNING, 1, ANNA)],
      worked: 1200,
      norm: 1200,
      difference: 0,
      total: "20 h z 20 h",
      words: "równo z normą",
    },
    {
      label: "four morning shifts at 3/4 of an FTE, above the norm of 30 h",
      fte: THREE_QUARTERS,
      assignments: fourMornings,
      worked: 1920,
      norm: 1800,
      difference: 120,
      total: "32 h z 30 h",
      words: "więcej o 2 h",
    },
    {
      label: "1028 minutes at 3/7 of an FTE, a minute below the rounded norm",
      fte: THREE_SEVENTHS,
      assignments: [assignment(MIN_1028.id, 0, ANNA)],
      worked: 1028,
      norm: 1029,
      difference: -1,
      total: "17 h 8 min z 17 h 9 min",
      words: "mniej o 1 min",
    },
    {
      label: "1029 minutes at 3/7 of an FTE, equal to the rounded norm",
      fte: THREE_SEVENTHS,
      assignments: [assignment(MIN_1029.id, 0, ANNA)],
      worked: 1029,
      norm: 1029,
      difference: 0,
      total: "17 h 9 min z 17 h 9 min",
      words: "równo z normą",
    },
    {
      label: "1030 minutes at 3/7 of an FTE, a minute above the rounded norm",
      fte: THREE_SEVENTHS,
      assignments: [assignment(MIN_1030.id, 0, ANNA)],
      worked: 1030,
      norm: 1029,
      difference: 1,
      total: "17 h 10 min z 17 h 9 min",
      words: "więcej o 1 min",
    },
  ])(
    "gives $total and $words for $label",
    ({ startDate = PLAIN_WEEK, fte = FULL, assignments, worked, norm, difference, total, words }) => {
      const rows = summarize([{ id: ANNA, fte }], assignments, startDate);

      expect(rows).toStrictEqual([
        { employeeId: ANNA, workedMinutes: worked, normMinutes: norm, differenceMinutes: difference },
      ]);
      expect(formatWorkload(rows[0])).toStrictEqual({ total, difference: words });
    },
  );

  it("takes the difference from the norm rounded to the minute, not from the exact one that the live rules use", () => {
    const [row] = summarize([{ id: ANNA, fte: THREE_SEVENTHS }], [assignment(MIN_1029.id, 0, ANNA)]);

    // 3/7 of 40 h is 1028.57 minutes: 1029 minutes is above it for the warning, and equal to the 17 h 9 min that is shown.
    expect(exceedsNorm(1029, weeklyNorm(PLAIN_WEEK, THREE_SEVENTHS))).toBe(true);
    expect(row.differenceMinutes).toBe(0);
    expect(formatWorkload(row).difference).toBe("równo z normą");
  });
});

describe("summarizeWorkload people", () => {
  it("gives a row to each person on the list, also to one with no assignment, sorted by id", () => {
    const rows = summarize(
      [
        { id: CEZARY, fte: FULL },
        { id: ANNA, fte: FULL },
        { id: BARTEK, fte: FULL },
      ],
      [assignment(MORNING, 0, ANNA), assignment(MORNING, 1, CEZARY), assignment(LONG, 2, CEZARY)],
    );

    expect(rows).toStrictEqual([
      { employeeId: ANNA, workedMinutes: 480, normMinutes: 2400, differenceMinutes: -1920 },
      { employeeId: BARTEK, workedMinutes: 0, normMinutes: 2400, differenceMinutes: -2400 },
      { employeeId: CEZARY, workedMinutes: 1200, normMinutes: 2400, differenceMinutes: -1200 },
    ]);
  });

  it("sorts the ids by code unit and not by the order of a locale", () => {
    const employees = ["a-employee", "c-employee", "B-employee"].map((id) => ({ id, fte: FULL }));

    // A locale puts "a" before "B"; the code unit of "B" (66) is below the one of "a" (97).
    expect(summarize(employees).map((row) => row.employeeId)).toStrictEqual(["B-employee", "a-employee", "c-employee"]);
  });

  it("leaves out the assignments of a person who is not on the list, and gives that person no row", () => {
    const rows = summarize(
      [{ id: ANNA, fte: FULL }],
      [assignment(MORNING, 0, ANNA), assignment(MORNING, 0, DANUTA), assignment(LONG, 1, DANUTA)],
    );

    expect(rows).toStrictEqual([{ employeeId: ANNA, workedMinutes: 480, normMinutes: 2400, differenceMinutes: -1920 }]);
  });

  it("gives no rows for an empty list, whatever the assignments", () => {
    expect(summarize([], [assignment(MORNING, 0, ANNA)])).toStrictEqual([]);
  });

  it("does not take an id that is the name of an object property for a person with hours", () => {
    const rows = summarize(
      [
        { id: "constructor", fte: FULL },
        { id: "toString", fte: FULL },
      ],
      [assignment(MORNING, 0, ANNA)],
    );

    expect(rows.map((row) => [row.employeeId, row.workedMinutes])).toStrictEqual([
      ["constructor", 0],
      ["toString", 0],
    ]);
  });

  it("keeps the difference as the sum less the norm in every row", () => {
    const rows = summarize(
      [
        { id: ANNA, fte: FULL },
        { id: BARTEK, fte: THREE_QUARTERS },
        { id: CEZARY, fte: THREE_SEVENTHS },
      ],
      [...onDays(LONG, [0, 1, 2], ANNA), ...onDays(MORNING, [3, 4], BARTEK), assignment(NIGHT, 6, CEZARY)],
      HOLIDAY_WEEK,
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.differenceMinutes).toBe(row.workedMinutes - row.normMinutes);
    }
  });
});

describe("summarizeWorkload with absences", () => {
  // The norm of a person with no shifts, from the week, the FTE and the absences. An approved absence takes 8 h times the FTE
  // off for each day from Monday to Friday that is not a holiday, once however many absences cover the day.
  it.each<{ label: string; startDate: string; fte: Fte; absences: AbsenceOption[]; norm: number; shown: string }>([
    {
      label: "three days of an approved absence, Monday to Wednesday",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-02", "2026-11-04")],
      norm: 960,
      shown: "16 h",
    },
    {
      label: "one day of an approved absence",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-04", "2026-11-04", ANNA, "sick_leave")],
      norm: 1920,
      shown: "32 h",
    },
    {
      label: "two absences that cover the same days, each day counted once",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-02", "2026-11-04"), absence("2026-11-03", "2026-11-05", ANNA, "other")],
      norm: 480,
      shown: "8 h",
    },
    {
      label: "an absence that began before the week and ends inside it",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-10-28", "2026-11-03")],
      norm: 1440,
      shown: "24 h",
    },
    {
      label: "an absence from Monday to Sunday, of which the five weekdays count",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-02", "2026-11-08")],
      norm: 0,
      shown: "0 min",
    },
    {
      label: "an absence on Saturday and Sunday only",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-07", "2026-11-08")],
      norm: 2400,
      shown: "40 h",
    },
    {
      label: "a requested absence for the whole week",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-02", "2026-11-06", ANNA, "vacation", "requested")],
      norm: 2400,
      shown: "40 h",
    },
    {
      label: "a rejected absence for the whole week",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-02", "2026-11-06", ANNA, "vacation", "rejected")],
      norm: 2400,
      shown: "40 h",
    },
    {
      label: "an approved absence of somebody else",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-11-02", "2026-11-06", BARTEK)],
      norm: 2400,
      shown: "40 h",
    },
    {
      label: "an absence that ended the day before the week",
      startDate: PLAIN_WEEK,
      fte: FULL,
      absences: [absence("2026-10-26", "2026-11-01")],
      norm: 2400,
      shown: "40 h",
    },
    {
      label: "an absence on the holiday of the week alone, which lowered the norm already",
      startDate: HOLIDAY_WEEK,
      fte: FULL,
      absences: [absence("2026-11-11", "2026-11-11")],
      norm: 1920,
      shown: "32 h",
    },
    {
      label: "an absence from the holiday to Friday: the holiday is not taken off twice",
      startDate: HOLIDAY_WEEK,
      fte: FULL,
      absences: [absence("2026-11-11", "2026-11-13")],
      norm: 960,
      shown: "16 h",
    },
    {
      label: "one day of absence at 3/4 of an FTE",
      startDate: PLAIN_WEEK,
      fte: THREE_QUARTERS,
      absences: [absence("2026-11-02", "2026-11-02")],
      norm: 1440,
      shown: "24 h",
    },
    {
      label: "two days of absence at 1/2 of an FTE",
      startDate: PLAIN_WEEK,
      fte: HALF,
      absences: [absence("2026-11-02", "2026-11-03")],
      norm: 720,
      shown: "12 h",
    },
    {
      // 24 h less 8 h for the holiday and 8 h for Thursday is 1440 minutes, and 3/7 of it is 617.14, shown as 10 h 17 min.
      label: "a day of absence in the week with a holiday, at 3/7 of an FTE (617.14 minutes)",
      startDate: HOLIDAY_WEEK,
      fte: THREE_SEVENTHS,
      absences: [absence("2026-11-12", "2026-11-12")],
      norm: 617,
      shown: "10 h 17 min",
    },
    {
      // Thursday 24.12, Friday 25.12 and Saturday 26.12 are holidays, and the absence on Monday to Wednesday would take the
      // norm below 0.
      label: "an absence after three holidays, which would take the norm below 0",
      startDate: "2026-12-24",
      fte: FULL,
      absences: [absence("2026-12-28", "2026-12-30")],
      norm: 0,
      shown: "0 min",
    },
  ])("gives a person with no shifts 0 min of $shown for $label", ({ startDate, fte, absences, norm, shown }) => {
    const rows = summarize([{ id: ANNA, fte }], [], startDate, absences);

    expect(rows).toStrictEqual([
      { employeeId: ANNA, workedMinutes: 0, normMinutes: norm, differenceMinutes: 0 - norm },
    ]);
    expect(formatWorkload(rows[0])).toStrictEqual({
      total: `0 min z ${shown}`,
      difference: norm === 0 ? "równo z normą" : `mniej o ${shown}`,
    });
  });

  it("gives the person with an absence a lower norm and takes the difference from it, and leaves the others as they were", () => {
    const rows = summarize(
      [
        { id: CEZARY, fte: HALF },
        { id: BARTEK, fte: FULL },
        { id: ANNA, fte: FULL },
      ],
      [
        ...onDays(MORNING, [3, 4], ANNA),
        ...onDays(MORNING, [0, 1, 2, 3], BARTEK),
        assignment(LONG, 0, CEZARY),
        assignment(MORNING, 1, CEZARY),
      ],
      PLAIN_WEEK,
      [absence("2026-11-02", "2026-11-03"), absence("2026-11-04", "2026-11-04", CEZARY, "sick_leave")],
    );

    expect(rows).toStrictEqual([
      // Two days off 40 h: 24 h.
      { employeeId: ANNA, workedMinutes: 960, normMinutes: 1440, differenceMinutes: -480 },
      // No absence: the norm of the week, and the same row as without absences.
      { employeeId: BARTEK, workedMinutes: 1920, normMinutes: 2400, differenceMinutes: -480 },
      // One day off 40 h, half of the rest: 16 h.
      { employeeId: CEZARY, workedMinutes: 1200, normMinutes: 960, differenceMinutes: 240 },
    ]);
    expect(rows.map((row) => formatWorkload(row))).toStrictEqual([
      { total: "16 h z 24 h", difference: "mniej o 8 h" },
      { total: "32 h z 40 h", difference: "mniej o 8 h" },
      { total: "20 h z 16 h", difference: "więcej o 4 h" },
    ]);
  });

  it("says that the person is above a norm of 0 for any work, and equal to it for none", () => {
    const week = [absence("2026-11-02", "2026-11-06")];

    const rows = [
      summarize([{ id: ANNA, fte: FULL }], [], PLAIN_WEEK, week),
      summarize([{ id: ANNA, fte: FULL }], [assignment(ONE_MINUTE.id, 5, ANNA)], PLAIN_WEEK, week),
      summarize([{ id: ANNA, fte: FULL }], [assignment(MORNING, 0, ANNA)], PLAIN_WEEK, week),
    ].flat();

    expect(rows.map((row) => row.normMinutes)).toStrictEqual([0, 0, 0]);
    expect(rows.map((row) => formatWorkload(row))).toStrictEqual([
      { total: "0 min z 0 min", difference: "równo z normą" },
      { total: "1 min z 0 min", difference: "więcej o 1 min" },
      { total: "8 h z 0 min", difference: "więcej o 8 h" },
    ]);
    // Nothing in a week of absence is "mniej o".
    expect(rows.every((row) => row.differenceMinutes >= 0)).toBe(true);
  });

  it("leaves out the absences of a person who is not on the list, and gives that person no row", () => {
    const withDanuta = summarize([{ id: ANNA, fte: FULL }], [assignment(MORNING, 0, ANNA)], PLAIN_WEEK, [
      absence("2026-11-02", "2026-11-06", DANUTA),
    ]);

    expect(withDanuta).toStrictEqual(summarize([{ id: ANNA, fte: FULL }], [assignment(MORNING, 0, ANNA)]));
    expect(summarize([], [], PLAIN_WEEK, [absence("2026-11-02", "2026-11-06")])).toStrictEqual([]);
  });

  it("gives exactly the rows of a week without absences for no list, an empty list and absences that take nothing off", () => {
    const people = [
      { id: ANNA, fte: FULL },
      { id: BARTEK, fte: THREE_SEVENTHS },
    ];
    const assignments = [...onDays(MORNING, [0, 1], ANNA), assignment(NIGHT, 6, BARTEK)];
    const without = summarize(people, assignments, HOLIDAY_WEEK);

    expect(summarize(people, assignments, HOLIDAY_WEEK, [])).toStrictEqual(without);
    expect(
      summarize(people, assignments, HOLIDAY_WEEK, [
        absence("2026-11-10", "2026-11-16", ANNA, "vacation", "rejected"),
        absence("2026-11-10", "2026-11-16", BARTEK, "other", "requested"),
        absence("2026-11-14", "2026-11-15", BARTEK),
        absence("2026-11-11", "2026-11-11", ANNA),
        absence("2026-12-01", "2026-12-05", ANNA),
      ]),
    ).toStrictEqual(without);
  });

  it("throws a RangeError for a start date or an FTE that is not valid, with absences as without", () => {
    const week = [absence("2026-11-02", "2026-11-03")];

    expect(() => summarize([{ id: ANNA, fte: FULL }], [], "2026-02-30", week)).toThrow(RangeError);
    expect(() => summarize([{ id: ANNA, fte: { numerator: 3, denominator: 2 } }], [], PLAIN_WEEK, week)).toThrow(
      RangeError,
    );
  });
});

// The hours of the people's table and the weekly_norm warning take their norm from the same days of absence and the same
// holidays, so for the same week, FTE and absences the warning's `limit` is the `normMinutes` of the row, and the warning
// says what the row shows as worked.
describe("the norm of the hours and the norm of the weekly_norm warning", () => {
  const NAMES: Record<string, string> = {
    [ANNA]: "Wiśniewska Anna",
    [BARTEK]: "Kowalski Bartek",
    [CEZARY]: "Nowak Cezary",
  };
  const fiveMornings = (employeeId: string) => onDays(MORNING, [0, 1, 2, 3, 4], employeeId);

  it.each<{
    label: string;
    startDate: string;
    employees: { id: string; fte: Fte }[];
    assignments: AssignmentInput[];
    absences: AbsenceOption[];
    norms: Record<string, number>;
    exceeding: string[];
  }>([
    {
      label: "three days of absence and a long week",
      startDate: PLAIN_WEEK,
      employees: [{ id: ANNA, fte: FULL }],
      assignments: onDays(LONG, [3, 4, 5], ANNA),
      absences: [absence("2026-11-02", "2026-11-04")],
      norms: { [ANNA]: 960 },
      exceeding: [ANNA],
    },
    {
      label: "a day of absence in the week with a holiday at 3/7 of an FTE",
      startDate: HOLIDAY_WEEK,
      employees: [{ id: ANNA, fte: THREE_SEVENTHS }],
      assignments: [assignment(LONG, 0, ANNA)],
      absences: [absence("2026-11-12", "2026-11-12")],
      norms: { [ANNA]: 617 },
      exceeding: [ANNA],
    },
    {
      label: "a whole week of absence and a single minute of work",
      startDate: PLAIN_WEEK,
      employees: [{ id: ANNA, fte: FULL }],
      assignments: [assignment(ONE_MINUTE.id, 2, ANNA)],
      absences: [absence("2026-11-02", "2026-11-08")],
      norms: { [ANNA]: 0 },
      exceeding: [ANNA],
    },
    {
      label: "an absence after three holidays, which would take the norm below 0",
      startDate: "2026-12-24",
      employees: [{ id: ANNA, fte: FULL }],
      assignments: [assignment(MORNING, 0, ANNA)],
      absences: [absence("2026-12-28", "2026-12-30")],
      norms: { [ANNA]: 0 },
      exceeding: [ANNA],
    },
    {
      label: "two days of absence at 1/2 of an FTE",
      startDate: PLAIN_WEEK,
      employees: [{ id: ANNA, fte: HALF }],
      assignments: [assignment(LONG, 0, ANNA), assignment(MORNING, 1, ANNA)],
      absences: [absence("2026-11-02", "2026-11-03")],
      norms: { [ANNA]: 720 },
      exceeding: [ANNA],
    },
    {
      label: "three people: one with an absence, one with a rejected one and one with a requested one",
      startDate: PLAIN_WEEK,
      employees: [
        { id: ANNA, fte: FULL },
        { id: BARTEK, fte: FULL },
        { id: CEZARY, fte: THREE_QUARTERS },
      ],
      assignments: [...fiveMornings(ANNA), ...fiveMornings(BARTEK), ...fiveMornings(CEZARY)],
      absences: [
        absence("2026-11-02", "2026-11-03"),
        absence("2026-11-02", "2026-11-06", BARTEK, "vacation", "rejected"),
        absence("2026-11-02", "2026-11-06", CEZARY, "sick_leave", "requested"),
      ],
      // Anna: 1440 (two days off). Bartek: 2400, so exactly his work. Cezary: 1800, 3/4 of 40 h, below his work.
      norms: { [ANNA]: 1440, [BARTEK]: 2400, [CEZARY]: 1800 },
      exceeding: [ANNA, CEZARY],
    },
  ])("is the same number for $label", ({ startDate, employees, assignments, absences, norms, exceeding }) => {
    const rows = summarizeWorkload({ startDate, assignments, shifts: ALL_SHIFTS, employees, absences });
    const violations = weeklyNormViolations({
      startDate,
      staffing: [],
      assignments,
      shifts: ALL_SHIFTS,
      employees: employees.map(({ id, fte }) => ({ id, name: NAMES[id], fte })),
      absences,
    });

    expect(Object.fromEntries(rows.map((row) => [row.employeeId, row.normMinutes]))).toStrictEqual(norms);
    expect(violations.map(({ employeeId }) => employeeId)).toStrictEqual(exceeding);
    for (const violation of violations) {
      const row = rows.find(({ employeeId }) => employeeId === violation.employeeId);

      expect(violation.limit).toBe(row?.normMinutes);
      expect(violation.actual).toBe(row?.workedMinutes);
    }
    // A person who is above the norm shown has a warning (the other way round does not hold: the warning compares with the
    // exact norm, so that equal to a rounded one can still exceed it).
    for (const row of rows.filter(({ differenceMinutes }) => differenceMinutes > 0)) {
      expect(exceeding).toContain(row.employeeId);
    }
  });
});

describe("repeatability of the workload with absences", () => {
  const people = [
    { id: ANNA, fte: FULL },
    { id: BARTEK, fte: HALF },
    { id: CEZARY, fte: THREE_SEVENTHS },
  ];
  const roster = [
    ...onDays(MORNING, [0, 2], ANNA),
    assignment(LONG, 4, ANNA),
    assignment(NIGHT, 6, BARTEK),
    assignment(MORNING, 1, BARTEK),
    assignment(LONG, 3, CEZARY),
    // Repeats, a shift without hours and a person who is not on the list, which must not change the rows.
    assignment(MORNING, 0, ANNA),
    assignment(UNKNOWN, 2, CEZARY),
    assignment(MORNING, 1, DANUTA),
  ];
  // In the week with a holiday on Wednesday 11.11: Anna has two days of approved absence (Thursday and Friday: 16 h off a
  // norm of 32 h), Bartek only a request (no effect), Cezary the holiday itself (no effect) and Monday 16.11 as a sick leave
  // (8 h off 32 h, and 3/7 of 24 h is 617.14 minutes). A rejected absence and one of a person who is not on the list change
  // nothing, and one absence is listed twice.
  const absences: AbsenceOption[] = [
    absence("2026-11-12", "2026-11-13", ANNA),
    absence("2026-11-13", "2026-11-13", ANNA, "other"),
    absence("2026-11-10", "2026-11-16", BARTEK, "vacation", "requested"),
    absence("2026-11-11", "2026-11-11", CEZARY),
    absence("2026-11-16", "2026-11-16", CEZARY, "sick_leave"),
    absence("2026-11-16", "2026-11-16", CEZARY, "sick_leave"),
    absence("2026-11-10", "2026-11-16", ANNA, "vacation", "rejected"),
    absence("2026-11-10", "2026-11-16", DANUTA),
  ];
  const input: WorkloadInput = {
    startDate: HOLIDAY_WEEK,
    assignments: roster,
    shifts: ALL_SHIFTS,
    employees: people,
    absences,
  };

  it("gives the same rows for repeated calls and for any order of the assignments, the shifts, the people and the absences", () => {
    const rows = expectDeterministic(summarizeWorkload, input, {
      variants: [1, 2, 3, 4, 5, 6].map((seed): WorkloadInput => ({
        startDate: HOLIDAY_WEEK,
        assignments: seededShuffle(roster, seed),
        shifts: seededShuffle(ALL_SHIFTS, seed + 100),
        employees: seededShuffle(people, seed + 200),
        absences: seededShuffle(absences, seed + 300),
      })),
    });

    expect(rows).toStrictEqual([
      { employeeId: ANNA, workedMinutes: 1680, normMinutes: 960, differenceMinutes: 720 },
      { employeeId: BARTEK, workedMinutes: 960, normMinutes: 960, differenceMinutes: 0 },
      { employeeId: CEZARY, workedMinutes: 720, normMinutes: 617, differenceMinutes: 103 },
    ]);
  });

  it("leaves the input unchanged, frozen as it is", () => {
    const frozen = Object.freeze({
      ...input,
      assignments: Object.freeze(roster.map((entry) => Object.freeze({ ...entry }))),
      shifts: Object.freeze(ALL_SHIFTS.map((shift) => Object.freeze({ ...shift }))),
      employees: Object.freeze(people.map(({ id, fte }) => Object.freeze({ id, fte: Object.freeze({ ...fte }) }))),
      absences: Object.freeze(absences.map((entry) => Object.freeze({ ...entry }))),
    });
    const before = structuredClone(frozen);

    const rows = summarizeWorkload(frozen);

    expect(structuredClone(frozen)).toStrictEqual(before);
    expect(rows.map((row) => row.normMinutes)).toStrictEqual([960, 960, 617]);
    expect(rows.every((row) => !Object.isFrozen(row))).toBe(true);
  });
});

describe("summarizeWorkload input", () => {
  it.each(["", "2026-02-30", "2019-12-31", "2100-01-01", "2026-11-10 "])(
    "throws a RangeError for the start date %j",
    (startDate) => {
      expect(() => summarize([{ id: ANNA, fte: FULL }], [], startDate)).toThrow(RangeError);
    },
  );

  it.each<[string, Fte]>([
    ["a zero numerator", { numerator: 0, denominator: 2 }],
    ["a numerator above the denominator", { numerator: 3, denominator: 2 }],
    ["a zero denominator", { numerator: 1, denominator: 0 }],
    ["a numerator with a fraction", { numerator: 1.5, denominator: 2 }],
  ])("throws a RangeError for %s", (_label, fte) => {
    expect(() => summarize([{ id: ANNA, fte }])).toThrow(RangeError);
  });

  it("returns new rows and leaves the input unchanged", () => {
    const input = Object.freeze({
      startDate: HOLIDAY_WEEK,
      assignments: Object.freeze(
        [assignment(NIGHT, 6, ANNA), assignment(MORNING, 0, BARTEK), assignment(UNKNOWN, 1, ANNA)].map((entry) =>
          Object.freeze(entry),
        ),
      ),
      shifts: Object.freeze(ALL_SHIFTS.map((shift) => Object.freeze({ ...shift }))),
      employees: Object.freeze(
        [
          { id: BARTEK, fte: HALF },
          { id: ANNA, fte: THREE_SEVENTHS },
        ].map(({ id, fte }) => Object.freeze({ id, fte: Object.freeze({ ...fte }) })),
      ),
    });
    const before = structuredClone(input);

    const rows = summarizeWorkload(input);

    expect(structuredClone(input)).toStrictEqual(before);
    expect(rows.map((row) => row.employeeId)).toStrictEqual([ANNA, BARTEK]);
    expect(Object.isFrozen(rows)).toBe(false);
    expect(rows.every((row) => !Object.isFrozen(row))).toBe(true);
  });
});

describe("formatWorkload", () => {
  it.each<{ label: string; worked: number; norm: number; total: string; words: string }>([
    { label: "8 h below the norm", worked: 1920, norm: 2400, total: "32 h z 40 h", words: "mniej o 8 h" },
    {
      label: "2 h 30 min above the norm",
      worked: 2550,
      norm: 2400,
      total: "42 h 30 min z 40 h",
      words: "więcej o 2 h 30 min",
    },
    { label: "the norm", worked: 2400, norm: 2400, total: "40 h z 40 h", words: "równo z normą" },
    { label: "no hours", worked: 0, norm: 2400, total: "0 min z 40 h", words: "mniej o 40 h" },
    { label: "a minute below the norm", worked: 2399, norm: 2400, total: "39 h 59 min z 40 h", words: "mniej o 1 min" },
    { label: "a minute above the norm", worked: 2401, norm: 2400, total: "40 h 1 min z 40 h", words: "więcej o 1 min" },
    {
      label: "less than an hour below the norm",
      worked: 1000,
      norm: 1029,
      total: "16 h 40 min z 17 h 9 min",
      words: "mniej o 29 min",
    },
    { label: "an hour above the norm", worked: 1920, norm: 1860, total: "32 h z 31 h", words: "więcej o 1 h" },
  ])("shows $label as $total and $words", ({ worked, norm, total, words }) => {
    const row: WorkloadRow = {
      employeeId: ANNA,
      workedMinutes: worked,
      normMinutes: norm,
      differenceMinutes: worked - norm,
    };

    expect(formatWorkload(row)).toStrictEqual({ total, difference: words });
  });

  it("has no minus sign in the difference, because the words carry the direction", () => {
    const below = formatWorkload({ employeeId: ANNA, workedMinutes: 0, normMinutes: 2400, differenceMinutes: -2400 });

    // The hyphen-minus (0x2D) and the minus sign (0x2212) that the coverage text uses.
    for (const code of [0x2d, 0x2212]) {
      expect(below.difference).not.toContain(String.fromCharCode(code));
    }
  });

  it("leaves the row unchanged", () => {
    const row = Object.freeze({ employeeId: ANNA, workedMinutes: 1920, normMinutes: 2400, differenceMinutes: -480 });
    const before = structuredClone(row);

    formatWorkload(row);

    expect(structuredClone(row)).toStrictEqual(before);
  });
});

describe("repeatability of the workload", () => {
  const people = [
    { id: ANNA, fte: FULL },
    { id: BARTEK, fte: HALF },
    { id: CEZARY, fte: THREE_SEVENTHS },
  ];
  // The norms of the week with a holiday on a Wednesday: 32 h, 16 h and 13 h 43 min (822.86 minutes).
  const norms: Record<string, number> = { [ANNA]: 1920, [BARTEK]: 960, [CEZARY]: 823 };
  const durationOf: Record<string, number> = { [MORNING]: 480, [NIGHT]: 480, [LONG]: 720 };
  const days = Array.from({ length: 7 }, (_unused, dayOffset) => dayOffset);

  // About half of the person, shift and day combinations, in no particular order of shift.
  const placed = SHIFTS.flatMap((shift, shiftIndex) =>
    people.flatMap(({ id }, personIndex) =>
      days
        .filter((dayOffset) => (shiftIndex + personIndex + dayOffset) % 2 === 0)
        .map((dayOffset) => assignment(shift.id, dayOffset, id)),
    ),
  );
  // Repeats, a shift without hours and a person who is not on the list, which must not change the rows.
  const roster = [
    ...placed,
    placed[0],
    placed[5],
    assignment(UNKNOWN, 2, ANNA),
    assignment(UNKNOWN, 0, CEZARY),
    assignment(MORNING, 1, DANUTA),
    assignment(LONG, 4, DANUTA),
  ];
  const input: WorkloadInput = { startDate: HOLIDAY_WEEK, assignments: roster, shifts: ALL_SHIFTS, employees: people };
  const seeds = [1, 2, 3, 4, 5, 6];

  it("gives the same rows for repeated calls and for any order of the assignments, the shifts and the people", () => {
    const rows = expectDeterministic(summarizeWorkload, input, {
      variants: [
        ...seeds.map((seed): WorkloadInput => ({
          startDate: HOLIDAY_WEEK,
          assignments: seededShuffle(roster, seed),
          shifts: seededShuffle(ALL_SHIFTS, seed + 100),
          employees: seededShuffle(people, seed + 200),
        })),
        { ...input, employees: [...people].reverse() },
      ],
    });

    const expected = people.map(({ id }): WorkloadRow => {
      const worked = placed
        .filter((entry) => entry.employeeId === id)
        .reduce((total, entry) => total + durationOf[entry.shiftId], 0);
      return {
        employeeId: id,
        workedMinutes: worked,
        normMinutes: norms[id],
        differenceMinutes: worked - norms[id],
      };
    });
    expect(rows).toStrictEqual(expected);
    // The roster has enough in it for the check to mean something.
    expect(rows.every((row) => row.workedMinutes > 0)).toBe(true);
  });

  it("gives the same text for repeated calls", () => {
    const row: WorkloadRow = { employeeId: ANNA, workedMinutes: 2550, normMinutes: 2400, differenceMinutes: 150 };

    expect(expectDeterministic(formatWorkload, row)).toStrictEqual({
      total: "42 h 30 min z 40 h",
      difference: "więcej o 2 h 30 min",
    });
  });
});

describe("the time zone", () => {
  it("calls no method of Date that reads or writes the local time", () => {
    const called = localDateMethodsCalledBy(() => {
      const rows = summarizeWorkload({
        startDate: HOLIDAY_WEEK,
        assignments: [assignment(NIGHT, 6, ANNA), assignment(MORNING, 0, ANNA), assignment(LONG, 2, BARTEK)],
        shifts: ALL_SHIFTS,
        employees: [
          { id: ANNA, fte: THREE_SEVENTHS },
          { id: BARTEK, fte: FULL },
        ],
      });
      for (const row of rows) {
        formatWorkload(row);
      }
      summarize([{ id: ANNA, fte: HALF }], [], "2099-12-31");
    });

    expect(called).toStrictEqual([]);
  });

  it("calls none of them for the absences either, over New Year, at the edge of the years and in a week with holidays", () => {
    const rows: WorkloadRow[][] = [];
    const called = localDateMethodsCalledBy(() => {
      rows.push(
        summarize([{ id: ANNA, fte: THREE_SEVENTHS }], [assignment(NIGHT, 6, ANNA)], "2026-12-29", [
          absence("2026-12-30", "2027-01-02"),
        ]),
        summarize([{ id: ANNA, fte: HALF }], [], "2099-12-31", [absence("2099-12-31", "2099-12-31")]),
        summarize([{ id: ANNA, fte: FULL }], [], HOLIDAY_WEEK, [absence("2026-11-11", "2026-11-13")]),
        summarize([{ id: ANNA, fte: FULL }], [], "2026-12-24", [absence("2026-12-28", "2026-12-30")]),
      );
    });

    expect(called).toStrictEqual([]);
    // The absences were really counted, in every one of the weeks: 3/7 of 16 h (the holiday of 1 January and two days of
    // absence off 40 h), half of 16 h (the holidays of 1 and 6 January 2100 and the Thursday of the absence off 40 h), 16 h
    // and 0.
    expect(rows.map(([row]) => row.normMinutes)).toStrictEqual([411, 480, 960, 0]);
  });
});
