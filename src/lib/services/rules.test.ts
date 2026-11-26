import { describe, expect, it } from "vitest";
import {
  DAILY_HOURS_MINUTES,
  DAILY_REST_MINUTES,
  DAY_WINDOW_MINUTES,
  RULE_RANK,
  WEEKLY_HOURS_MINUTES,
  WEEKLY_REST_MINUTES,
  WEEKLY_REST_SHIFT_CHANGE_MINUTES,
  WEEK_MINUTES,
  anchorKey,
  compareViolations,
  dailyHoursViolations,
  dailyRestViolations,
  evaluateSchedule,
  summarizeViolations,
  understaffedViolations,
  violationKey,
  weeklyHoursViolations,
  weeklyNormViolations,
  weeklyRestViolations,
  type RuleInput,
} from "@/lib/services/rules";
import { MINUTES_PER_DAY } from "@/lib/services/shift";
import type { ShiftTimes } from "@/lib/services/work-hours";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import { localDateMethodsCalledBy } from "@/lib/testing/local-time";
import type { AssignmentInput, Fte, Violation, ViolationRule } from "@/types";

// The shifts are referred to by id only. By id they order as NIGHT, DAY, MORNING, LONG, EVENING, NIGHT_LONG, and the
// employees as ANNA, BARTEK, CEZARY, which is not the order of the names (Kowalski, Nowak, Wiśniewska), so only a sort by
// id can produce the order of a result.
const NIGHT = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";
const DAY = "3c9d5e7f-2a4b-4c6d-8e0f-1a3b5c7d9e24";
const MORNING = "5f1c9a3e-2b7d-4e60-8c14-9a0d3e7b1f25";
const LONG = "a3d7e1f4-6c52-4b98-8e0a-1f9c2d5b7a36";
const EVENING = "b8a6c4e2-0d9f-4b7a-8c5e-3f1d9b7a5c82";
const NIGHT_LONG = "d1f3b5a7-9c2e-4e4a-8b6d-0c2e4a6b8d10";
const UNKNOWN = "00000000-0000-4000-8000-000000000001";
const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const CEZARY = "c0ffee00-1111-4222-8333-444455556666";

// Monday 2 November 2026: the days are pon. 02.11, wt. 03.11, śr. 04.11, czw. 05.11, pt. 06.11, sob. 07.11, niedz. 08.11.
const START_DATE = "2026-11-02";
const PERIOD = "02.11–08.11.2026";

const MORNING_SHIFT: ShiftTimes = { id: MORNING, name: "Poranna", startMinute: 360, endMinute: 840 };
const DAY_SHIFT: ShiftTimes = { id: DAY, name: "Dzienna", startMinute: 480, endMinute: 960 };
const EVENING_SHIFT: ShiftTimes = { id: EVENING, name: "Wieczorna", startMinute: 840, endMinute: 1320 };
const NIGHT_SHIFT: ShiftTimes = { id: NIGHT, name: "Nocna", startMinute: 1320, endMinute: 360 };
const LONG_SHIFT: ShiftTimes = { id: LONG, name: "Długa", startMinute: 480, endMinute: 1200 };
// 22:00-07:00, 9 h: longer than the 8 h of a day.
const NIGHT_LONG_SHIFT: ShiftTimes = { id: NIGHT_LONG, name: "Nocna długa", startMinute: 1320, endMinute: 420 };
const SHIFTS = [MORNING_SHIFT, DAY_SHIFT, EVENING_SHIFT, NIGHT_SHIFT, LONG_SHIFT, NIGHT_LONG_SHIFT];

const FULL: Fte = { numerator: 1, denominator: 1 };
const EMPLOYEES = [
  { id: ANNA, name: "Wiśniewska Anna", fte: FULL },
  { id: BARTEK, name: "Kowalski Bartek", fte: FULL },
  { id: CEZARY, name: "Nowak Cezary", fte: FULL },
];

function assignment(shiftId: string, dayOffset: number, employeeId: string): AssignmentInput {
  return { shiftId, dayOffset, employeeId };
}

function customShift(id: string, name: string, startMinute: number, endMinute: number): ShiftTimes {
  return { id, name, startMinute, endMinute };
}

function input(assignments: AssignmentInput[], extra: Partial<RuleInput> = {}): RuleInput {
  return { startDate: START_DATE, staffing: [], assignments, shifts: SHIFTS, employees: EMPLOYEES, ...extra };
}

// Back-to-back shifts of at most 1000 minutes that cover the timeline from `from` to `to` without a break, as shifts to
// add to the input and the assignments of one person to them: a person who works all the time between two points.
function chain(employeeId: string, from: number, to: number, tag: string) {
  const shifts: ShiftTimes[] = [];
  const assignments: AssignmentInput[] = [];
  for (let start = from; start < to; start += 1000) {
    const end = Math.min(start + 1000, to);
    const id = `${tag}-${shifts.length}`;
    shifts.push(customShift(id, `Ciągła ${shifts.length}`, start % MINUTES_PER_DAY, end % MINUTES_PER_DAY));
    assignments.push(assignment(id, Math.floor(start / MINUTES_PER_DAY), employeeId));
  }
  return { shifts, assignments };
}

// The shifts and the assignments that give a person exactly `minutes` of work: shifts of 600 minutes at most, one a day from
// the first day on (so up to 4200 minutes). The other rules have their say about these shifts, which are meant for the norm.
function work(employeeId: string, minutes: number) {
  const shifts: ShiftTimes[] = [];
  const assignments: AssignmentInput[] = [];
  for (let left = minutes; left > 0; left -= 600) {
    const id = `${employeeId}-work-${shifts.length}`;
    shifts.push(customShift(id, `Praca ${shifts.length}`, 360, (360 + Math.min(left, 600)) % MINUTES_PER_DAY));
    assignments.push(assignment(id, assignments.length, employeeId));
  }
  return { shifts, assignments };
}

// Anna (a full-time employee, unless `extra` says otherwise) works exactly `minutes` in the week.
function workedCase(minutes: number, extra: Partial<RuleInput> = {}): RuleInput {
  const { shifts, assignments } = work(ANNA, minutes);
  return input(assignments, { shifts: [...SHIFTS, ...shifts], ...extra });
}

// Every rule, in the order of its rank.
const ALL_RULES = (Object.keys(RULE_RANK) as ViolationRule[]).sort((a, b) => RULE_RANK[a] - RULE_RANK[b]);

const reasonsOf = (violations: readonly Violation[]) => violations.map(({ reason }) => reason);
const keysOf = (violations: readonly Violation[]) => violations.map(({ key }) => key);
const rulesOf = (violations: readonly Violation[]) => violations.map(({ rule }) => rule);

function anchorsOf(violation: Violation): string[] {
  return violation.anchors.map(anchorKey);
}

// The four critical rules together: what `evaluateSchedule` gives without its two warnings.
function criticalOf(rules: RuleInput): Violation[] {
  return evaluateSchedule(rules).filter(({ severity }) => severity === "critical");
}

describe("the thresholds", () => {
  it("are the 11 h, 8 h, 24 h window, 48 h, 35 h and 24 h of the work-time rules, and the seven days of a schedule", () => {
    expect(DAILY_REST_MINUTES).toBe(660);
    expect(DAILY_HOURS_MINUTES).toBe(480);
    expect(DAY_WINDOW_MINUTES).toBe(1440);
    expect(WEEKLY_HOURS_MINUTES).toBe(2880);
    expect(WEEKLY_REST_MINUTES).toBe(2100);
    expect(WEEKLY_REST_SHIFT_CHANGE_MINUTES).toBe(1440);
    expect(WEEK_MINUTES).toBe(10080);
  });

  it("rank the rules in the order of a result, each with a rank of its own", () => {
    expect(ALL_RULES).toStrictEqual([
      "daily_rest",
      "daily_hours",
      "weekly_hours",
      "weekly_rest",
      "weekly_norm",
      "understaffed",
    ]);
    expect(new Set(Object.values(RULE_RANK)).size).toBe(ALL_RULES.length);
  });
});

describe("the key of a violation", () => {
  it("is the rule, the employee and the anchors sorted by their keys, with no number computed from the data", () => {
    const key = violationKey("daily_rest", ANNA, [
      { shiftId: NIGHT, dayOffset: 1, employeeId: ANNA },
      { shiftId: MORNING, dayOffset: 0, employeeId: ANNA },
    ]);

    expect(key).toBe(`daily_rest|${ANNA}|0:${MORNING}:${ANNA},1:${NIGHT}:${ANNA}`);
  });

  it("puts a dash where there is no employee, and nothing after the bar when there is no anchor", () => {
    expect(violationKey("understaffed", null, [{ shiftId: NIGHT, dayOffset: 2, employeeId: null }])).toBe(
      `understaffed|-|2:${NIGHT}:-`,
    );
    expect(violationKey("weekly_rest", ANNA, [])).toBe(`weekly_rest|${ANNA}|`);
  });

  it("does not depend on the order of the anchors, and leaves them unchanged", () => {
    const anchors = Object.freeze([
      Object.freeze({ shiftId: NIGHT, dayOffset: 3, employeeId: ANNA }),
      Object.freeze({ shiftId: MORNING, dayOffset: 3, employeeId: ANNA }),
      Object.freeze({ shiftId: NIGHT, dayOffset: 0, employeeId: ANNA }),
    ]);

    expect(violationKey("daily_hours", ANNA, anchors)).toBe(
      violationKey("daily_hours", ANNA, [anchors[2], anchors[1], anchors[0]]),
    );
    expect(anchors.map(anchorKey)).toStrictEqual([`3:${NIGHT}:${ANNA}`, `3:${MORNING}:${ANNA}`, `0:${NIGHT}:${ANNA}`]);
  });
});

describe("compareViolations", () => {
  function violation(overrides: Partial<Violation>): Violation {
    return {
      key: "k",
      severity: "critical",
      rule: "daily_rest",
      employeeId: ANNA,
      anchors: [],
      reason: "r",
      actual: 0,
      limit: 0,
      unit: "minutes",
      ...overrides,
    };
  }

  // In the canonical order: the severity, the rule, the employee, the key.
  const ordered: Violation[] = [
    violation({ key: "a" }),
    violation({ key: "b" }),
    violation({ key: "a", employeeId: BARTEK }),
    violation({ rule: "daily_hours" }),
    violation({ rule: "weekly_hours", employeeId: CEZARY }),
    violation({ rule: "weekly_rest" }),
    violation({ severity: "warning", rule: "daily_rest" }),
    violation({ severity: "warning", rule: "weekly_norm" }),
    violation({ severity: "warning", rule: "understaffed", employeeId: null, key: "x" }),
    violation({ severity: "warning", rule: "understaffed", employeeId: null, key: "y" }),
  ];

  it.each([1, 2, 3, 4, 5, 6])("sorts a shuffle of the list (seed %d) back into the canonical order", (seed) => {
    expect([...seededShuffle(ordered, seed)].sort(compareViolations)).toStrictEqual(ordered);
  });

  it("puts every critical violation before every warning, whatever the rule", () => {
    const warning = violation({ severity: "warning", rule: "daily_rest" });
    const critical = violation({ rule: "weekly_rest" });

    expect(compareViolations(critical, warning)).toBeLessThan(0);
    expect(compareViolations(warning, critical)).toBeGreaterThan(0);
  });

  it("compares the text by code unit, not by locale: an upper-case letter comes before a lower-case one", () => {
    expect(compareViolations(violation({ key: "B" }), violation({ key: "a" }))).toBeLessThan(0);
    expect(compareViolations(violation({ employeeId: "Z" }), violation({ employeeId: "a" }))).toBeLessThan(0);
  });

  it("puts a cell without an employee after an employee, and says zero for equal violations", () => {
    expect(compareViolations(violation({ employeeId: null }), violation({ employeeId: "z" }))).toBeGreaterThan(0);
    expect(compareViolations(violation({}), violation({}))).toBe(0);
  });
});

describe("dailyRestViolations", () => {
  // A morning shift on Monday that ends at 14:00 (minute 840) and a shift of 2 h that starts `gap` minutes later, which is
  // on Tuesday for a long gap. A negative gap puts it inside the morning shift.
  function restCase(gap: number): RuleInput {
    const start = 840 + gap;
    const after = customShift("after", "Po przerwie", start % MINUTES_PER_DAY, (start + 120) % MINUTES_PER_DAY);
    return input([assignment(MORNING, 0, ANNA), assignment("after", Math.floor(start / MINUTES_PER_DAY), ANNA)], {
      shifts: [...SHIFTS, after],
    });
  }

  it.each<{ gap: number; violates: boolean }>([
    { gap: -1, violates: true },
    { gap: 0, violates: true },
    { gap: 1, violates: true },
    { gap: 480, violates: true },
    { gap: 659, violates: true },
    { gap: 660, violates: false },
    { gap: 661, violates: false },
    { gap: 1000, violates: false },
  ])("says $violates for a break of $gap minutes between two shifts", ({ gap, violates }) => {
    const violations = dailyRestViolations(restCase(gap));

    expect(violations.map(({ actual }) => actual)).toStrictEqual(violates ? [Math.max(gap, 0)] : []);
    expect(violations.map(({ limit }) => limit)).toStrictEqual(violates ? [660] : []);
    expect(violations.map(({ rule, severity, unit }) => [rule, severity, unit])).toStrictEqual(
      violates ? [["daily_rest", "critical", "minutes"]] : [],
    );
  });

  it("reports the 8 h break of the rules document: the shift ends at 22:00 and the next starts at 06:00", () => {
    const violations = dailyRestViolations(input([assignment(EVENING, 0, ANNA), assignment(MORNING, 1, ANNA)]));

    expect(violations).toStrictEqual([
      {
        key: `daily_rest|${ANNA}|0:${EVENING}:${ANNA},1:${MORNING}:${ANNA}`,
        severity: "critical",
        rule: "daily_rest",
        employeeId: ANNA,
        anchors: [
          { shiftId: EVENING, dayOffset: 0, employeeId: ANNA },
          { shiftId: MORNING, dayOffset: 1, employeeId: ANNA },
        ],
        reason:
          "Wiśniewska Anna: przerwa 8 h między zmianami Wieczorna (pon. 02.11, 14:00–22:00) i Poranna (wt. 03.11, 06:00–14:00), wymagane co najmniej 11 h.",
        actual: 480,
        limit: 660,
        unit: "minutes",
      },
    ]);
  });

  it("accepts the 11 h break of the rules document: the shift ends at 22:00 and the next starts at 09:00", () => {
    const late = customShift("l", "Od dziewiątej", 540, 1020);

    expect(
      dailyRestViolations(
        input([assignment(EVENING, 0, ANNA), assignment("l", 1, ANNA)], { shifts: [...SHIFTS, late] }),
      ),
    ).toStrictEqual([]);
  });

  it("names the break of 0 minutes between two shifts one after the other", () => {
    const violations = dailyRestViolations(input([assignment(MORNING, 0, ANNA), assignment(EVENING, 0, ANNA)]));

    expect(reasonsOf(violations)).toStrictEqual([
      "Wiśniewska Anna: przerwa 0 min między zmianami Poranna (pon. 02.11, 06:00–14:00) i Wieczorna (pon. 02.11, 14:00–22:00), wymagane co najmniej 11 h.",
    ]);
  });

  it("reports a night shift that follows a day shift on the same day (6 h) and a morning right after a night (0 min)", () => {
    const sameDay = dailyRestViolations(input([assignment(DAY, 0, ANNA), assignment(NIGHT, 0, ANNA)]));
    const nextMorning = dailyRestViolations(input([assignment(NIGHT, 0, ANNA), assignment(MORNING, 1, ANNA)]));

    expect(reasonsOf(sameDay)).toStrictEqual([
      "Wiśniewska Anna: przerwa 6 h między zmianami Dzienna (pon. 02.11, 08:00–16:00) i Nocna (pon. 02.11, 22:00–06:00), wymagane co najmniej 11 h.",
    ]);
    expect(reasonsOf(nextMorning)).toStrictEqual([
      "Wiśniewska Anna: przerwa 0 min między zmianami Nocna (pon. 02.11, 22:00–06:00) i Poranna (wt. 03.11, 06:00–14:00), wymagane co najmniej 11 h.",
    ]);
  });

  it("accepts a night shift on the day after a day shift", () => {
    expect(dailyRestViolations(input([assignment(DAY, 0, ANNA), assignment(NIGHT, 1, ANNA)]))).toStrictEqual([]);
  });

  it("reports two shifts of one person on one day that leave less than 11 h (8 h here)", () => {
    const violations = dailyRestViolations(input([assignment(NIGHT_LONG, 0, ANNA), assignment(MORNING, 0, ANNA)]));

    expect(reasonsOf(violations)).toStrictEqual([
      "Wiśniewska Anna: przerwa 8 h między zmianami Poranna (pon. 02.11, 06:00–14:00) i Nocna długa (pon. 02.11, 22:00–07:00), wymagane co najmniej 11 h.",
    ]);
  });

  it("gives an overlap its own reason, with no rest at all and the length of the overlap", () => {
    const violations = dailyRestViolations(input([assignment(LONG, 0, ANNA), assignment(MORNING, 0, ANNA)]));

    expect(violations).toStrictEqual([
      {
        key: `daily_rest|${ANNA}|0:${MORNING}:${ANNA},0:${LONG}:${ANNA}`,
        severity: "critical",
        rule: "daily_rest",
        employeeId: ANNA,
        anchors: [
          { shiftId: MORNING, dayOffset: 0, employeeId: ANNA },
          { shiftId: LONG, dayOffset: 0, employeeId: ANNA },
        ],
        reason:
          "Wiśniewska Anna: zmiany Poranna (pon. 02.11, 06:00–14:00) i Długa (pon. 02.11, 08:00–20:00) nakładają się o 6 h, wymagana przerwa co najmniej 11 h.",
        actual: 0,
        limit: 660,
        unit: "minutes",
      },
    ]);
  });

  it("counts the rest from the end of a long shift that holds a shorter one, not from the shorter one", () => {
    // 08:00-20:00 holds 10:00-12:00; the shift on Tuesday at 06:00 comes 10 h after the long one and 18 h after the short.
    const inside = customShift("in", "Wewnątrz", 600, 720);
    const violations = dailyRestViolations(
      input([assignment(LONG, 0, ANNA), assignment("in", 0, ANNA), assignment(MORNING, 1, ANNA)], {
        shifts: [...SHIFTS, inside],
      }),
    );

    expect(violations.map(anchorsOf)).toStrictEqual([
      [`0:${LONG}:${ANNA}`, `0:in:${ANNA}`],
      [`0:${LONG}:${ANNA}`, `1:${MORNING}:${ANNA}`],
    ]);
    expect(violations.map(({ actual }) => actual)).toStrictEqual([0, 600]);
  });

  it("reports each person for their own shifts and never across two people", () => {
    const apart = input([assignment(EVENING, 0, ANNA), assignment(MORNING, 1, BARTEK)]);
    const together = input([
      assignment(EVENING, 0, BARTEK),
      assignment(EVENING, 0, ANNA),
      assignment(MORNING, 1, BARTEK),
    ]);

    expect(dailyRestViolations(apart)).toStrictEqual([]);
    expect(dailyRestViolations(together).map(({ employeeId }) => employeeId)).toStrictEqual([BARTEK]);
  });

  it("counts the same assignment twice as one, so it does not overlap itself", () => {
    expect(dailyRestViolations(input([assignment(DAY, 0, ANNA), assignment(DAY, 0, ANNA)]))).toStrictEqual([]);
  });

  it("gives no violation for a person with one shift, or with no shift at all", () => {
    expect(dailyRestViolations(input([assignment(DAY, 0, ANNA)]))).toStrictEqual([]);
    expect(dailyRestViolations(input([]))).toStrictEqual([]);
  });
});

describe("dailyHoursViolations", () => {
  it.each<{ minutes: number; violates: boolean }>([
    { minutes: 479, violates: false },
    { minutes: 480, violates: false },
    { minutes: 481, violates: true },
    { minutes: 720, violates: true },
  ])("says $violates for one shift of $minutes minutes", ({ minutes, violates }) => {
    const shift = customShift("s", "Jedna", 360, 360 + minutes);

    const violations = dailyHoursViolations(input([assignment("s", 0, ANNA)], { shifts: [...SHIFTS, shift] }));

    expect(violations.map(({ actual }) => actual)).toStrictEqual(violates ? [minutes] : []);
    expect(violations.map(({ limit }) => limit)).toStrictEqual(violates ? [480] : []);
    expect(violations.map(({ rule, severity }) => [rule, severity])).toStrictEqual(
      violates ? [["daily_hours", "critical"]] : [],
    );
  });

  // 08:00-16:00 on Monday (8 h) and a shift of 6 h on Tuesday that starts `early` minutes before 08:00, so that `early`
  // minutes of it fall into the 24 h that start at 08:00 on Monday.
  function windowCase(early: number): RuleInput {
    const start = 1920 - early;
    const tuesday = customShift("t", "Wtorek", start % MINUTES_PER_DAY, (start + 360) % MINUTES_PER_DAY);
    return input([assignment(DAY, 0, ANNA), assignment("t", 1, ANNA)], { shifts: [...SHIFTS, tuesday] });
  }

  it.each<{ early: number; worked: number; violates: boolean }>([
    { early: 0, worked: 480, violates: false },
    { early: 1, worked: 481, violates: true },
    { early: 60, worked: 540, violates: true },
    { early: 120, worked: 600, violates: true },
  ])(
    "counts $worked minutes in the window that opens at 08:00 when the next shift starts $early minutes before 08:00",
    ({ early, worked, violates }) => {
      const violations = dailyHoursViolations(windowCase(early));

      expect(violations.map(({ actual }) => actual)).toStrictEqual(violates ? [worked] : []);
      expect(violations.map(({ limit }) => limit)).toStrictEqual(violates ? [480] : []);
    },
  );

  it("reports the rotation of 08:00-16:00 on Monday and 06:00-14:00 on Tuesday: 10 h in the 24 h from 08:00", () => {
    const violations = dailyHoursViolations(input([assignment(DAY, 0, ANNA), assignment(MORNING, 1, ANNA)]));

    expect(violations).toStrictEqual([
      {
        // The key is the assignment that opens the window; the anchors hold both shifts that reach into it.
        key: `daily_hours|${ANNA}|0:${DAY}:${ANNA}`,
        severity: "critical",
        rule: "daily_hours",
        employeeId: ANNA,
        anchors: [
          { shiftId: DAY, dayOffset: 0, employeeId: ANNA },
          { shiftId: MORNING, dayOffset: 1, employeeId: ANNA },
        ],
        reason: "Wiśniewska Anna: w dobie liczonej od pon. 02.11, 08:00 przepracowane 10 h, dopuszczalne najwyżej 8 h.",
        actual: 600,
        limit: 480,
        unit: "minutes",
      },
    ]);
    // The rest between them (14 h) is fine, so the day is the only rule that sees the rotation.
    expect(dailyRestViolations(input([assignment(DAY, 0, ANNA), assignment(MORNING, 1, ANNA)]))).toStrictEqual([]);
  });

  it("accepts the same two days without the earlier start: 08:00-16:00 on both", () => {
    expect(dailyHoursViolations(input([assignment(DAY, 0, ANNA), assignment(DAY, 1, ANNA)]))).toStrictEqual([]);
  });

  it("adds the sentence about the equivalent working-time system for a shift longer than 8 h", () => {
    const violations = dailyHoursViolations(input([assignment(LONG, 2, ANNA)]));

    expect(reasonsOf(violations)).toStrictEqual([
      "Wiśniewska Anna: w dobie liczonej od śr. 04.11, 08:00 przepracowane 12 h, dopuszczalne najwyżej 8 h. Zmiana dłuższa niż 8 h wymaga systemu równoważnego czasu pracy (art. 135), którego Shiftly nie obsługuje.",
    ]);
  });

  it("leaves the sentence out when no shift in the window is longer than 8 h", () => {
    const violations = dailyHoursViolations(input([assignment(DAY, 0, ANNA), assignment(MORNING, 1, ANNA)]));

    expect(violations.every(({ reason }) => !reason.includes("art. 135"))).toBe(true);
  });

  it("reports a night shift after a day shift: 16 h in the 24 h from the start of the day shift", () => {
    const violations = dailyHoursViolations(input([assignment(DAY, 0, ANNA), assignment(NIGHT, 0, ANNA)]));

    expect(reasonsOf(violations)).toStrictEqual([
      "Wiśniewska Anna: w dobie liczonej od pon. 02.11, 08:00 przepracowane 16 h, dopuszczalne najwyżej 8 h.",
    ]);
  });

  it("reports two shifts of one person on one day once, with both anchors and the sentence for the long one", () => {
    const violations = dailyHoursViolations(input([assignment(MORNING, 0, ANNA), assignment(NIGHT_LONG, 0, ANNA)]));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ actual: 960, limit: 480 });
    expect(anchorsOf(violations[0])).toStrictEqual([`0:${MORNING}:${ANNA}`, `0:${NIGHT_LONG}:${ANNA}`]);
    expect(violations[0].reason).toBe(
      "Wiśniewska Anna: w dobie liczonej od pon. 02.11, 06:00 przepracowane 16 h, dopuszczalne najwyżej 8 h. Zmiana dłuższa niż 8 h wymaga systemu równoważnego czasu pracy (art. 135), którego Shiftly nie obsługuje.",
    );
  });

  it("counts the end of a night shift from the last day past the edge of the schedule", () => {
    // 22:00-07:00 on the last day is 9 h; cut at midnight of the edge it would be 2 h.
    const violations = dailyHoursViolations(input([assignment(NIGHT_LONG, 6, ANNA)]));

    expect(violations.map(({ actual }) => actual)).toStrictEqual([540]);
    expect(violations[0].reason).toContain("w dobie liczonej od niedz. 08.11, 22:00 przepracowane 9 h");
  });

  describe("a group of overlapping windows", () => {
    // Three shifts of 5 h with 1 h between them: 04:00-09:00, 10:00-15:00 and 16:00-21:00.
    const first = customShift("g1", "Pierwsza", 240, 540);
    const second = customShift("g2", "Druga", 600, 900);
    const third = customShift("g3", "Trzecia", 960, 1260);
    const shifts = [...SHIFTS, first, second, third];
    const monday = [assignment("g1", 0, ANNA), assignment("g2", 0, ANNA), assignment("g3", 0, ANNA)];

    it("is reported once, for the first window: the second window (10 h) opens inside it", () => {
      const violations = dailyHoursViolations(input(monday, { shifts }));

      expect(violations).toHaveLength(1);
      expect(violations[0].actual).toBe(900);
      expect(anchorsOf(violations[0])).toStrictEqual([`0:g1:${ANNA}`, `0:g2:${ANNA}`, `0:g3:${ANNA}`]);
    });

    it("keeps its key when another shift is added to the window, and only the list of anchors grows", () => {
      // 04:00-09:00 and 10:00-15:00 make 10 h in the window that opens at 04:00; the third shift (16:00-21:00) joins it.
      const two = dailyHoursViolations(input(monday.slice(0, 2), { shifts }));
      const three = dailyHoursViolations(input(monday, { shifts }));

      expect(keysOf(two)).toStrictEqual([`daily_hours|${ANNA}|0:g1:${ANNA}`]);
      expect(keysOf(three)).toStrictEqual(keysOf(two));
      expect(two.map(anchorsOf)).toStrictEqual([[`0:g1:${ANNA}`, `0:g2:${ANNA}`]]);
      expect(three.map(anchorsOf)).toStrictEqual([[`0:g1:${ANNA}`, `0:g2:${ANNA}`, `0:g3:${ANNA}`]]);
      expect([two[0].actual, three[0].actual]).toStrictEqual([600, 900]);
    });

    it("is keyed by the opening assignment whatever the order of the input, and by another one in another window", () => {
      const reversed = dailyHoursViolations(input([...monday].reverse(), { shifts: [...shifts].reverse() }));
      const later = dailyHoursViolations(input([assignment("g2", 0, ANNA), assignment("g3", 0, ANNA)], { shifts }));

      expect(keysOf(reversed)).toStrictEqual([`daily_hours|${ANNA}|0:g1:${ANNA}`]);
      // Without the first shift the window opens at 10:00 and holds 10 h: a finding of its own, with its own key.
      expect(keysOf(later)).toStrictEqual([`daily_hours|${ANNA}|0:g2:${ANNA}`]);
    });

    it("is reported again when the next group starts after the 24 h of the first", () => {
      const thursday = monday.map(({ shiftId }) => assignment(shiftId, 3, ANNA));

      const violations = dailyHoursViolations(input([...monday, ...thursday], { shifts }));

      expect(violations).toHaveLength(2);
      expect(new Set(keysOf(violations)).size).toBe(2);
      expect(violations.map(({ anchors }) => anchors.map(({ dayOffset }) => dayOffset))).toStrictEqual([
        [0, 0, 0],
        [3, 3, 3],
      ]);
    });

    it("is not hidden by an earlier window that holds no violation: the window of Monday (8 h) opens no group", () => {
      // The 24 h from 08:00 on Monday hold 8 h; those from 08:00 on Tuesday hold the day shift and the night shift (16 h).
      const violations = dailyHoursViolations(
        input([assignment(DAY, 0, ANNA), assignment(DAY, 1, ANNA), assignment(NIGHT, 1, ANNA)]),
      );

      expect(violations.map(anchorsOf)).toStrictEqual([[`1:${NIGHT}:${ANNA}`, `1:${DAY}:${ANNA}`]]);
      expect(violations.map(({ actual }) => actual)).toStrictEqual([960]);
    });
  });
});

describe("weeklyHoursViolations", () => {
  // Six shifts of 8 h (days 0 to 5), which is exactly 48 h, and a short shift of `extra` minutes on the last day.
  function weekCase(extra: number): RuleInput {
    const days = [0, 1, 2, 3, 4, 5].map((dayOffset) => assignment(DAY, dayOffset, ANNA));
    const more = customShift("more", "Dodatkowa", 480, 480 + extra);
    return input(extra > 0 ? [...days, assignment("more", 6, ANNA)] : days, { shifts: [...SHIFTS, more] });
  }

  it.each<{ extra: number; total: number; violates: boolean }>([
    { extra: 0, total: 2880, violates: false },
    { extra: 1, total: 2881, violates: true },
    { extra: 480, total: 3360, violates: true },
  ])("says $violates for $total minutes in the week", ({ extra, total, violates }) => {
    const violations = weeklyHoursViolations(weekCase(extra));

    expect(violations.map(({ actual }) => actual)).toStrictEqual(violates ? [total] : []);
    expect(violations.map(({ limit }) => limit)).toStrictEqual(violates ? [2880] : []);
  });

  it("gives the whole week of one person, with no anchors, in a stable key and a Polish reason", () => {
    expect(weeklyHoursViolations(weekCase(1))).toStrictEqual([
      {
        key: `weekly_hours|${ANNA}|`,
        severity: "critical",
        rule: "weekly_hours",
        employeeId: ANNA,
        anchors: [],
        reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 48 h 1 min, dopuszczalne najwyżej 48 h.`,
        actual: 2881,
        limit: 2880,
        unit: "minutes",
      },
    ]);
  });

  it("counts a night shift from the last day in full", () => {
    const days = [0, 1, 2, 3, 4, 5].map((dayOffset) => assignment(DAY, dayOffset, ANNA));

    const violations = weeklyHoursViolations(input([...days, assignment(NIGHT, 6, ANNA)]));

    expect(violations.map(({ actual }) => actual)).toStrictEqual([3360]);
  });

  it("adds up each person on their own", () => {
    const days = [0, 1, 2, 3, 4, 5].map((dayOffset) => assignment(DAY, dayOffset, ANNA));
    const bartek = [0, 1, 2].map((dayOffset) => assignment(DAY, dayOffset, BARTEK));

    const violations = weeklyHoursViolations(input([...days, assignment(NIGHT, 6, BARTEK), ...bartek, days[3]]));

    expect(violations).toStrictEqual([]);
  });
});

describe("weeklyRestViolations", () => {
  // One person works all the time but for one break of `gap` minutes, so that the break is the only one of the week. The
  // shift before it ends at minute 1500 (01:00 on Tuesday). The shift after it, of 10 h, starts at the same time of the day
  // as the one before when `sameStart` is true, and at another time when it is not. With `edges` the person is also free
  // for `head` minutes at the start of the schedule and for `tail` minutes at its end, which is one break across the edge.
  function weeklyRestCase(gap: number, sameStart: boolean, edges = { head: 0, tail: 0 }): RuleInput {
    const end = 1500;
    const length = sameStart ? (MINUTES_PER_DAY - (gap % MINUTES_PER_DAY)) % MINUTES_PER_DAY : 600;
    const before = customShift("before", "Przed przerwą", (end - length) % MINUTES_PER_DAY, end % MINUTES_PER_DAY);
    const afterStart = end + gap;
    const after = customShift(
      "after",
      "Po przerwie",
      afterStart % MINUTES_PER_DAY,
      (afterStart + 600) % MINUTES_PER_DAY,
    );
    const earlier = chain(ANNA, edges.head, end - length, "pre");
    const later = chain(ANNA, afterStart + 600, WEEK_MINUTES - edges.tail, "post");
    return input(
      [
        ...earlier.assignments,
        assignment("before", Math.floor((end - length) / MINUTES_PER_DAY), ANNA),
        assignment("after", Math.floor(afterStart / MINUTES_PER_DAY), ANNA),
        ...later.assignments,
      ],
      { shifts: [...SHIFTS, ...earlier.shifts, before, after, ...later.shifts] },
    );
  }

  it.each<{ gap: number; sameStart: boolean; limit: number; violates: boolean }>([
    { gap: 2099, sameStart: true, limit: 2100, violates: true },
    { gap: 2100, sameStart: true, limit: 2100, violates: false },
    { gap: 2101, sameStart: true, limit: 2100, violates: false },
    { gap: 1500, sameStart: true, limit: 2100, violates: true },
    { gap: 1439, sameStart: false, limit: 1440, violates: true },
    { gap: 1440, sameStart: false, limit: 1440, violates: false },
    { gap: 1441, sameStart: false, limit: 1440, violates: false },
    { gap: 2099, sameStart: false, limit: 1440, violates: false },
  ])(
    "says $violates for a break of $gap minutes when the shifts around it start at the same time: $sameStart",
    ({ gap, sameStart, limit, violates }) => {
      const violations = weeklyRestViolations(weeklyRestCase(gap, sameStart));

      expect(violations.map(({ actual }) => actual)).toStrictEqual(violates ? [gap] : []);
      expect(violations.map((violation) => violation.limit)).toStrictEqual(violates ? [limit] : []);
      expect(violations.map(({ rule, severity }) => [rule, severity])).toStrictEqual(
        violates ? [["weekly_rest", "critical"]] : [],
      );
    },
  );

  it("gives the 35 h reason for a week with a shift every day: 06:00-14:00 leaves 16 h, tail 10 h and head 6 h as one", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOffset) => assignment(MORNING, dayOffset, ANNA));

    // Every break is 16 h, the one across the edge too (10 h from Sunday 14:00 to the end and 6 h to Monday 06:00), and the
    // break across the edge is the one named when breaks tie.
    expect(weeklyRestViolations(input(week))).toStrictEqual([
      {
        key: `weekly_rest|${ANNA}|`,
        severity: "critical",
        rule: "weekly_rest",
        employeeId: ANNA,
        anchors: [],
        reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) najdłuższa przerwa trwa 16 h (od niedz. 08.11, 14:00 do końca grafiku i od początku grafiku do pon. 02.11, 06:00), wymagany odpoczynek tygodniowy co najmniej 35 h.`,
        actual: 960,
        limit: 2100,
        unit: "minutes",
      },
    ]);
  });

  it("names the break across the edge when it is strictly the longest of the week", () => {
    // Shifts 08:00-16:00 on days 0 to 5 and 06:00-14:00 on day 6: the breaks between days are 16 h and 14 h, and the one
    // across the edge is 10 h to the end of the schedule plus 8 h from its start, 18 h.
    const days = [0, 1, 2, 3, 4, 5].map((dayOffset) => assignment(DAY, dayOffset, ANNA));

    const violations = weeklyRestViolations(input([...days, assignment(MORNING, 6, ANNA)]));

    expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual([[1080, 2100]]);
    expect(reasonsOf(violations)).toStrictEqual([
      `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) najdłuższa przerwa trwa 18 h (od niedz. 08.11, 14:00 do końca grafiku i od początku grafiku do pon. 02.11, 08:00), wymagany odpoczynek tygodniowy co najmniej 35 h.`,
    ]);
  });

  it("names the break between two days, not the one across the edge, when the break between days is longer", () => {
    // Shifts 06:00-14:00 on days 0 to 5 and 06:00-22:00 on day 6 (16 h): a break of 16 h between days, and 2 h to the end
    // of the schedule plus 6 h from its start across the edge, 8 h.
    const days = [0, 1, 2, 3, 4, 5].map((dayOffset) => assignment(MORNING, dayOffset, ANNA));
    const wide = customShift("wide", "Szeroka", 360, 1320);

    const violations = weeklyRestViolations(
      input([...days, assignment("wide", 6, ANNA)], { shifts: [...SHIFTS, wide] }),
    );

    expect(reasonsOf(violations)).toStrictEqual([
      `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) najdłuższa przerwa trwa 16 h (od pon. 02.11, 14:00 do wt. 03.11, 06:00), wymagany odpoczynek tygodniowy co najmniej 35 h.`,
    ]);
  });

  it("gives the 24 h reason, which says why the threshold is lower, for a change of shift", () => {
    const violations = weeklyRestViolations(weeklyRestCase(1439, false));

    expect(reasonsOf(violations)).toStrictEqual([
      `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) najdłuższa przerwa trwa 23 h 59 min (od wt. 03.11, 01:00 do śr. 04.11, 00:59), wymagany odpoczynek tygodniowy co najmniej 24 h (skrócony z 35 h przy przejściu na inną zmianę, bo zmiany przed przerwą i po niej zaczynają się o innej godzinie).`,
    ]);
  });

  describe("a person with few shifts", () => {
    it.each<{ label: string; assignments: AssignmentInput[] }>([
      { label: "one shift on the first day", assignments: [assignment(DAY, 0, ANNA)] },
      { label: "one shift on a day in the middle", assignments: [assignment(DAY, 3, ANNA)] },
      {
        label: "two shifts on a day in the middle (the daily rest is another rule)",
        assignments: [assignment(MORNING, 3, ANNA), assignment(EVENING, 3, ANNA)],
      },
      { label: "a night shift on the last day", assignments: [assignment(NIGHT, 6, ANNA)] },
    ])("is never reported for $label", ({ assignments }) => {
      expect(weeklyRestViolations(input(assignments))).toStrictEqual([]);
    });
  });

  describe("the break across the edge of the schedule", () => {
    // The free time at the end of the schedule and at its start is one break: the neighbouring week is assumed to have the
    // same free time at this edge, and nothing is read from outside the schedule.
    it("is one break: Tuesday to Saturday 06:00-14:00 leaves 34 h at the end and 30 h at the start, 64 h across the edge", () => {
      const days = [1, 2, 3, 4, 5].map((dayOffset) => assignment(MORNING, dayOffset, ANNA));

      // Neither the 30 h at the start nor the 34 h at the end reaches 35 h alone, and the breaks between days are 16 h.
      expect(weeklyRestViolations(input(days))).toStrictEqual([]);
    });

    it("is one break: Monday to Saturday 06:00-14:00 leaves 34 h at the end and 6 h at the start, 40 h across the edge", () => {
      const days = [0, 1, 2, 3, 4, 5].map((dayOffset) => assignment(MORNING, dayOffset, ANNA));

      expect(weeklyRestViolations(input(days))).toStrictEqual([]);
    });

    it.each<{ head: number; tail: number; violates: boolean }>([
      { head: 1000, tail: 1100, violates: false },
      { head: 1000, tail: 1099, violates: true },
      { head: 1500, tail: 600, violates: false },
      { head: 1500, tail: 599, violates: true },
      { head: 1, tail: 2099, violates: false },
      { head: 1, tail: 2098, violates: true },
    ])(
      "is 2100 minutes at the least: $head minutes at the start and $tail at the end are a violation: $violates",
      ({ head, tail, violates }) => {
        // Each part is shorter than the 2100 minutes of the weekly rest, and the person works all the time in between.
        const week = chain(ANNA, head, WEEK_MINUTES - tail, "all");

        const violations = weeklyRestViolations(input(week.assignments, { shifts: [...SHIFTS, ...week.shifts] }));

        expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual(
          violates ? [[head + tail, 2100]] : [],
        );
        expect(violations.every(({ reason }) => reason.includes("do końca grafiku i od początku grafiku do"))).toBe(
          true,
        );
      },
    );

    it("never takes the 24 h of a change of shift, although the shifts on both sides start at different times", () => {
      // The first shift starts at 12:30 and the last one at 01:50, and the 25 h across the edge are below 35 h.
      const week = chain(ANNA, 750, 9330, "all");

      const violations = weeklyRestViolations(input(week.assignments, { shifts: [...SHIFTS, ...week.shifts] }));

      expect(week.shifts[0].startMinute).not.toBe(week.shifts[week.shifts.length - 1].startMinute);
      expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual([[1500, 2100]]);
      expect(violations[0].reason).not.toContain("skrócony");
    });

    it.each<{ gap: number; edges: { head: number; tail: number }; result: number[][] }>([
      // The break between two shifts that start at different times is enough from 24 h on, whatever the edges are.
      { gap: 1440, edges: { head: 300, tail: 300 }, result: [] },
      { gap: 1440, edges: { head: 600, tail: 1200 }, result: [] },
      { gap: 1439, edges: { head: 300, tail: 300 }, result: [[1439, 1440]] },
      // The break across the edge (1800 minutes) is longer, but it needs the 35 h and so it is the one named.
      { gap: 1439, edges: { head: 600, tail: 1200 }, result: [[1800, 2100]] },
    ])(
      "keeps the 24 h of a break between shifts of $gap minutes when the edges leave $edges.head and $edges.tail minutes",
      ({ gap, edges, result }) => {
        const violations = weeklyRestViolations(weeklyRestCase(gap, false, edges));

        expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual(result);
      },
    );
  });

  describe("a break at one edge only", () => {
    it.each([
      { tail: 2099, violates: true },
      { tail: 2100, violates: false },
      { tail: 2101, violates: false },
    ])(
      "at the end: $tail minutes after a shift that starts at midnight of the first day are a violation: $violates",
      ({ tail, violates }) => {
        const week = chain(ANNA, 0, WEEK_MINUTES - tail, "all");

        const violations = weeklyRestViolations(input(week.assignments, { shifts: [...SHIFTS, ...week.shifts] }));

        expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual(violates ? [[tail, 2100]] : []);
        expect(
          violations.map(({ reason }) => reason.includes("(od sob. 07.11, 13:01 do końca grafiku)")),
        ).toStrictEqual(violates ? [true] : []);
      },
    );

    it.each([
      { head: 2099, violates: true },
      { head: 2100, violates: false },
      { head: 2101, violates: false },
    ])(
      "at the start: $head minutes before the first shift, which lasts to the end of the schedule, are a violation: $violates",
      ({ head, violates }) => {
        const week = chain(ANNA, head, WEEK_MINUTES, "all");

        const violations = weeklyRestViolations(input(week.assignments, { shifts: [...SHIFTS, ...week.shifts] }));

        expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual(violates ? [[head, 2100]] : []);
        expect(
          violations.map(({ reason }) => reason.includes("(od początku grafiku do wt. 03.11, 10:59)")),
        ).toStrictEqual(violates ? [true] : []);
      },
    );

    it("does not add a break at the end for a night shift from the last day, which ends past the edge", () => {
      // Work from 01:00 on Tuesday to the end of the night shift of the last day (22:00 to 06:00 of the week after): the
      // only break is the 25 h at the start, which is not extended by the end past the edge.
      const week = chain(ANNA, 1500, 9960, "mid");

      const violations = weeklyRestViolations(
        input([...week.assignments, assignment(NIGHT, 6, ANNA)], { shifts: [...SHIFTS, ...week.shifts] }),
      );

      expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual([[1500, 2100]]);
      expect(violations[0].reason).toContain("(od początku grafiku do wt. 03.11, 01:00)");
    });

    it("judges the break before a night shift from the last day by the 24 h of a change of shift", () => {
      const days = [0, 1, 2, 3, 4, 5].map((dayOffset) => assignment(DAY, dayOffset, ANNA));

      // From Saturday 16:00 to the night shift at 22:00 on Sunday is 30 h: enough after a change of shift (24 h).
      expect(weeklyRestViolations(input([...days, assignment(NIGHT, 6, ANNA)]))).toStrictEqual([]);
    });
  });

  it("reports a person who has no break at all", () => {
    const week = chain(ANNA, 0, WEEK_MINUTES, "all");

    const violations = weeklyRestViolations(input(week.assignments, { shifts: [...SHIFTS, ...week.shifts] }));

    expect(violations).toStrictEqual([
      {
        key: `weekly_rest|${ANNA}|`,
        severity: "critical",
        rule: "weekly_rest",
        employeeId: ANNA,
        anchors: [],
        reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) nie ma żadnej przerwy, wymagany odpoczynek tygodniowy co najmniej 35 h.`,
        actual: 0,
        limit: 2100,
        unit: "minutes",
      },
    ]);
  });

  it("gives no violation for a person without shifts, and none for the people who have none among others who have", () => {
    expect(weeklyRestViolations(input([]))).toStrictEqual([]);
    expect(weeklyRestViolations(input([assignment(DAY, 0, BARTEK)]))).toStrictEqual([]);
  });
});

describe("weeklyNormViolations", () => {
  const fte = (numerator: number, denominator: number): Fte => ({ numerator, denominator });
  const onlyAnna = (anna: Fte) => [{ id: ANNA, name: "Wiśniewska Anna", fte: anna }];

  it.each<{ fte: Fte; worked: number; violates: boolean; limit: number }>([
    { fte: FULL, worked: 2399, violates: false, limit: 2400 },
    { fte: FULL, worked: 2400, violates: false, limit: 2400 },
    { fte: FULL, worked: 2401, violates: true, limit: 2400 },
    { fte: fte(3, 4), worked: 1800, violates: false, limit: 1800 },
    { fte: fte(3, 4), worked: 1801, violates: true, limit: 1800 },
    { fte: fte(1, 2), worked: 1200, violates: false, limit: 1200 },
    { fte: fte(1, 2), worked: 1201, violates: true, limit: 1200 },
    // 3/7 of 40 h is 1028.57 minutes: the norm shows as 1029, but the comparison is exact, so 1029 exceeds it and 1028 does not.
    { fte: fte(3, 7), worked: 1028, violates: false, limit: 1029 },
    { fte: fte(3, 7), worked: 1029, violates: true, limit: 1029 },
    { fte: fte(3, 7), worked: 1030, violates: true, limit: 1029 },
  ])(
    "says $violates for $worked minutes of an employee with the FTE $fte.numerator/$fte.denominator",
    ({ fte: employeeFte, worked, violates, limit }) => {
      const violations = weeklyNormViolations(workedCase(worked, { employees: onlyAnna(employeeFte) }));

      expect(violations.map(({ actual }) => actual)).toStrictEqual(violates ? [worked] : []);
      expect(violations.map((violation) => violation.limit)).toStrictEqual(violates ? [limit] : []);
      expect(violations.map(({ rule, severity, unit }) => [rule, severity, unit])).toStrictEqual(
        violates ? [["weekly_norm", "warning", "minutes"]] : [],
      );
    },
  );

  it("is a warning of the whole week of one person: a stable key, no anchors and a Polish reason with the FTE", () => {
    expect(weeklyNormViolations(workedCase(2401))).toStrictEqual([
      {
        key: `weekly_norm|${ANNA}|`,
        severity: "warning",
        rule: "weekly_norm",
        employeeId: ANNA,
        anchors: [],
        reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 40 h 1 min, norma tygodniowa (pełny etat) to 40 h.`,
        actual: 2401,
        limit: 2400,
        unit: "minutes",
      },
    ]);
  });

  it.each<{ fte: Fte; worked: number; startDate?: string; reason: string }>([
    {
      fte: fte(3, 4),
      worked: 1801,
      reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 30 h 1 min, norma tygodniowa (3/4 etatu) to 30 h.`,
    },
    {
      fte: fte(1, 2),
      worked: 1201,
      reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 20 h 1 min, norma tygodniowa (1/2 etatu) to 20 h.`,
    },
    {
      // The norm is rounded to the minute for people: 17 h 9 min, and the work equals it but is above the exact norm
      // (1028.57 minutes) by a fraction of a minute, which the reason says.
      fte: fte(3, 7),
      worked: 1029,
      reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 17 h 9 min, norma tygodniowa (3/7 etatu) to 17 h 9 min (przekroczona o ułamek minuty).`,
    },
    {
      // 1/7 of 40 h is 342.86 minutes, shown as 5 h 43 min (343): the work equals the rounded norm again.
      fte: fte(1, 7),
      worked: 343,
      reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 5 h 43 min, norma tygodniowa (1/7 etatu) to 5 h 43 min (przekroczona o ułamek minuty).`,
    },
    {
      // A minute above the rounded norm: the two numbers differ, so there is nothing to explain.
      fte: fte(1, 7),
      worked: 344,
      reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 5 h 44 min, norma tygodniowa (1/7 etatu) to 5 h 43 min.`,
    },
    {
      // The norm rounds down (1/7 of 32 h is 274.29 minutes, shown as 274): 275 is above both, no remark.
      fte: fte(1, 7),
      worked: 275,
      startDate: "2026-11-10",
      reason:
        "Wiśniewska Anna: w tygodniu grafiku (10.11–16.11.2026) łączny czas pracy 4 h 35 min, norma tygodniowa (1/7 etatu) to 4 h 34 min po pomniejszeniu o święto 11.11.",
    },
    {
      // The remark comes after the holidays that lowered the norm (3/7 of 32 h is 822.86 minutes, shown as 823).
      fte: fte(3, 7),
      worked: 823,
      startDate: "2026-11-10",
      reason:
        "Wiśniewska Anna: w tygodniu grafiku (10.11–16.11.2026) łączny czas pracy 13 h 43 min, norma tygodniowa (3/7 etatu) to 13 h 43 min po pomniejszeniu o święto 11.11 (przekroczona o ułamek minuty).",
    },
    {
      // A norm that is a whole number of minutes (1/5 of 40 h is 480): the limit is exact, so there is never a remark.
      fte: fte(1, 5),
      worked: 481,
      reason: `Wiśniewska Anna: w tygodniu grafiku (${PERIOD}) łączny czas pracy 8 h 1 min, norma tygodniowa (1/5 etatu) to 8 h.`,
    },
  ])(
    "names the FTE of $fte.numerator/$fte.denominator in the reason, with the remark on a fraction of a minute only when the numbers are equal",
    ({ fte: employeeFte, worked, startDate, reason }) => {
      const rules = workedCase(worked, { employees: onlyAnna(employeeFte), startDate: startDate ?? START_DATE });

      expect(reasonsOf(weeklyNormViolations(rules))).toStrictEqual([reason]);
    },
  );

  // The norm of a week is lowered by 8 h times the FTE for each holiday on a day other than Sunday, and the reason names them.
  it.each<{ startDate: string; employeeFte: Fte; norm: number; reason: string }>([
    {
      // Wednesday 11.11 is a holiday.
      startDate: "2026-11-10",
      employeeFte: FULL,
      norm: 1920,
      reason:
        "Wiśniewska Anna: w tygodniu grafiku (10.11–16.11.2026) łączny czas pracy 32 h 1 min, norma tygodniowa (pełny etat) to 32 h po pomniejszeniu o święto 11.11.",
    },
    {
      startDate: "2026-11-10",
      employeeFte: fte(3, 4),
      norm: 1440,
      reason:
        "Wiśniewska Anna: w tygodniu grafiku (10.11–16.11.2026) łączny czas pracy 24 h 1 min, norma tygodniowa (3/4 etatu) to 24 h po pomniejszeniu o święto 11.11.",
    },
    {
      // Friday 25.12 and Saturday 26.12.
      startDate: "2026-12-25",
      employeeFte: FULL,
      norm: 1440,
      reason:
        "Wiśniewska Anna: w tygodniu grafiku (25.12–31.12.2026) łączny czas pracy 24 h 1 min, norma tygodniowa (pełny etat) to 24 h po pomniejszeniu o święta 25.12 i 26.12.",
    },
    {
      // Thursday 24.12 (a day off from 2025), then 25.12 and 26.12.
      startDate: "2026-12-24",
      employeeFte: FULL,
      norm: 960,
      reason:
        "Wiśniewska Anna: w tygodniu grafiku (24.12–30.12.2026) łączny czas pracy 16 h 1 min, norma tygodniowa (pełny etat) to 16 h po pomniejszeniu o święta 24.12, 25.12 i 26.12.",
    },
    {
      // The only holiday of the week, 1.11, is a Sunday: the norm stays 40 h and the reason has no holiday.
      startDate: "2026-10-26",
      employeeFte: FULL,
      norm: 2400,
      reason:
        "Wiśniewska Anna: w tygodniu grafiku (26.10–01.11.2026) łączny czas pracy 40 h 1 min, norma tygodniowa (pełny etat) to 40 h.",
    },
  ])(
    "lowers the norm to $norm minutes for the week from $startDate and says why",
    ({ startDate, employeeFte, norm, reason }) => {
      const at = (worked: number) => workedCase(worked, { startDate, employees: onlyAnna(employeeFte) });

      expect(weeklyNormViolations(at(norm))).toStrictEqual([]);
      const violations = weeklyNormViolations(at(norm + 1));
      expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual([[norm + 1, norm]]);
      expect(reasonsOf(violations)).toStrictEqual([reason]);
    },
  );

  it("gives the critical weekly hours and the weekly norm warning together for a person above 48 h", () => {
    const all = evaluateSchedule(workedCase(2881));

    expect(
      all
        .filter(({ rule }) => rule === "weekly_hours" || rule === "weekly_norm")
        .map(({ rule, severity, actual, limit }) => [rule, severity, actual, limit]),
    ).toStrictEqual([
      ["weekly_hours", "critical", 2881, 2880],
      ["weekly_norm", "warning", 2881, 2400],
    ]);
  });

  it("gives only the warning for a person at exactly 48 h, who is above the norm and within the limit", () => {
    const all = evaluateSchedule(workedCase(2880));

    expect(all.map(({ rule }) => rule).filter((rule) => rule === "weekly_hours")).toStrictEqual([]);
    expect(all.map(({ rule }) => rule).filter((rule) => rule === "weekly_norm")).toStrictEqual(["weekly_norm"]);
  });

  it("skips a person who is not on the list of employees, because there is no FTE to take the norm of", () => {
    const stranger = workedCase(3000, { employees: [{ id: BARTEK, name: "Kowalski Bartek", fte: FULL }] });

    expect(weeklyNormViolations(stranger)).toStrictEqual([]);
    expect(weeklyNormViolations(workedCase(3000, { employees: [] }))).toStrictEqual([]);
    // The rules that need no FTE still see the person, by id.
    expect(weeklyHoursViolations(stranger).map(({ employeeId }) => employeeId)).toStrictEqual([ANNA]);
  });

  it("judges each person by their own FTE", () => {
    const anna = work(ANNA, 2401);
    const bartek = work(BARTEK, 1200);
    const cezary = work(CEZARY, 1801);

    const violations = weeklyNormViolations(
      input([...anna.assignments, ...bartek.assignments, ...cezary.assignments], {
        shifts: [...SHIFTS, ...anna.shifts, ...bartek.shifts, ...cezary.shifts],
        employees: [
          { id: CEZARY, name: "Nowak Cezary", fte: fte(3, 4) },
          { id: BARTEK, name: "Kowalski Bartek", fte: fte(1, 2) },
          { id: ANNA, name: "Wiśniewska Anna", fte: FULL },
        ],
      }),
    );

    // Bartek works exactly the 20 h of half a post. The list is by employee id.
    expect(violations.map(({ employeeId, actual, limit }) => [employeeId, actual, limit])).toStrictEqual([
      [ANNA, 2401, 2400],
      [CEZARY, 1801, 1800],
    ]);
  });

  it("counts the same assignment once and leaves out a shift that has no hours", () => {
    const week = [0, 1, 2, 3, 4].map((dayOffset) => assignment(DAY, dayOffset, ANNA));

    expect(weeklyNormViolations(input([...week, ...week, assignment(UNKNOWN, 5, ANNA)]))).toStrictEqual([]);
    expect(weeklyNormViolations(input([...week, assignment(MORNING, 5, ANNA)]))).toHaveLength(1);
  });

  it("gives nothing for an employee with no work, and judges an employee listed twice once", () => {
    expect(weeklyNormViolations(input([]))).toStrictEqual([]);
    expect(weeklyNormViolations(workedCase(2401, { employees: [...onlyAnna(FULL), ...onlyAnna(FULL)] }))).toHaveLength(
      1,
    );
  });
});

describe("understaffedViolations", () => {
  const cell = (requiredCount: number, shiftId = MORNING, dayOffset = 0) => ({ shiftId, dayOffset, requiredCount });
  const people = [ANNA, BARTEK, CEZARY, "extra-1"];
  const placed = (count: number, shiftId = MORNING, dayOffset = 0) =>
    people.slice(0, count).map((employeeId) => assignment(shiftId, dayOffset, employeeId));

  it.each<{ assigned: number; missing: number }>([
    { assigned: 0, missing: 3 },
    { assigned: 1, missing: 2 },
    { assigned: 2, missing: 1 },
    { assigned: 3, missing: 0 },
    { assigned: 4, missing: 0 },
  ])("says $missing missing for $assigned people on a cell that needs 3", ({ assigned, missing }) => {
    const violations = understaffedViolations(input(placed(assigned), { staffing: [cell(3)] }));

    expect(violations).toStrictEqual(
      missing === 0
        ? []
        : [
            {
              key: `understaffed|-|0:${MORNING}:-`,
              severity: "warning",
              rule: "understaffed",
              employeeId: null,
              anchors: [{ shiftId: MORNING, dayOffset: 0, employeeId: null }],
              reason: `Brak obsady: zmiana Poranna (pon. 02.11, 06:00–14:00): przypisano ${assigned} z 3, brakuje ${missing}.`,
              actual: assigned,
              limit: 3,
              unit: "people",
            },
          ],
    );
  });

  it("is never a violation for a surplus: a cell in surplus next to a cell in shortage leaves only the shortage", () => {
    const staffing = [cell(1, MORNING, 0), cell(2, EVENING, 3)];
    const assignments = [...placed(3, MORNING, 0), ...placed(1, EVENING, 3)];

    const violations = understaffedViolations(input(assignments, { staffing }));

    expect(violations.map(anchorsOf)).toStrictEqual([[`3:${EVENING}:-`]]);
    expect(evaluateSchedule(input(placed(3), { staffing: [cell(1)] })).map(({ rule }) => rule)).not.toContain(
      "understaffed",
    );
  });

  it("gives a warning for every cell when there is no assignment at all, in the order of the key", () => {
    const staffing = [cell(2, NIGHT, 1), cell(1, MORNING, 2), cell(3, MORNING, 0)];

    const violations = understaffedViolations(input([], { staffing }));

    expect(keysOf(violations)).toStrictEqual([
      `understaffed|-|0:${MORNING}:-`,
      `understaffed|-|1:${NIGHT}:-`,
      `understaffed|-|2:${MORNING}:-`,
    ]);
    expect(violations.map(({ actual, limit }) => [actual, limit])).toStrictEqual([
      [0, 3],
      [0, 2],
      [0, 1],
    ]);
    expect(reasonsOf(violations)).toStrictEqual([
      "Brak obsady: zmiana Poranna (pon. 02.11, 06:00–14:00): przypisano 0 z 3, brakuje 3.",
      "Brak obsady: zmiana Nocna (wt. 03.11, 22:00–06:00): przypisano 0 z 2, brakuje 2.",
      "Brak obsady: zmiana Poranna (śr. 04.11, 06:00–14:00): przypisano 0 z 1, brakuje 1.",
    ]);
  });

  it("gives nothing for a schedule with no staffing, and nothing for a complete one", () => {
    expect(understaffedViolations(input(placed(2)))).toStrictEqual([]);
    expect(understaffedViolations(input(placed(2), { staffing: [cell(2)] }))).toStrictEqual([]);
  });

  it("counts the same person twice on a cell as one, and not the people on other cells", () => {
    const assignments = [assignment(MORNING, 0, ANNA), assignment(MORNING, 0, ANNA), assignment(MORNING, 1, BARTEK)];

    expect(reasonsOf(understaffedViolations(input(assignments, { staffing: [cell(2)] })))).toStrictEqual([
      "Brak obsady: zmiana Poranna (pon. 02.11, 06:00–14:00): przypisano 1 z 2, brakuje 1.",
    ]);
  });

  it("names a shift that is not in the list of shifts by its id, with the day only, and still counts the people", () => {
    const violations = understaffedViolations(
      input([assignment(UNKNOWN, 3, ANNA)], { staffing: [cell(2, UNKNOWN, 3)] }),
    );

    expect(reasonsOf(violations)).toStrictEqual([
      `Brak obsady: zmiana ${UNKNOWN} (czw. 05.11): przypisano 1 z 2, brakuje 1.`,
    ]);
    expect(violations.map(anchorsOf)).toStrictEqual([[`3:${UNKNOWN}:-`]]);
  });
});

describe("evaluateSchedule", () => {
  // Anna breaks the daily rest and the hours of a day (an evening shift, then a morning one), Bartek works the seven days
  // (the weekly hours, the weekly rest and the norm) and Cezary, at 3/4 of a post, works five days above his norm. The
  // staffing has a cell that is short, one that is complete, one in surplus and one without any assignment.
  const scenario = input(
    [
      assignment(EVENING, 0, ANNA),
      assignment(MORNING, 1, ANNA),
      ...[0, 1, 2, 3, 4, 5, 6].map((dayOffset) => assignment(DAY, dayOffset, BARTEK)),
      ...[1, 2, 3, 4, 5].map((dayOffset) => assignment(DAY, dayOffset, CEZARY)),
    ],
    {
      staffing: [
        { shiftId: DAY, dayOffset: 0, requiredCount: 3 },
        { shiftId: DAY, dayOffset: 1, requiredCount: 2 },
        { shiftId: DAY, dayOffset: 2, requiredCount: 1 },
        { shiftId: NIGHT, dayOffset: 4, requiredCount: 1 },
      ],
      employees: [
        { id: ANNA, name: "Wiśniewska Anna", fte: FULL },
        { id: BARTEK, name: "Kowalski Bartek", fte: FULL },
        { id: CEZARY, name: "Nowak Cezary", fte: { numerator: 3, denominator: 4 } },
      ],
    },
  );

  it("gives no violation for a complete schedule in which everybody keeps every rule", () => {
    const keeping = input(
      [
        ...[0, 1, 2, 3, 4].map((dayOffset) => assignment(DAY, dayOffset, ANNA)),
        ...[0, 1, 2, 3, 4].map((dayOffset) => assignment(MORNING, dayOffset, BARTEK)),
        assignment(EVENING, 0, CEZARY),
        assignment(EVENING, 1, CEZARY),
      ],
      {
        staffing: [
          ...[0, 1, 2, 3, 4].map((dayOffset) => ({ shiftId: DAY, dayOffset, requiredCount: 1 })),
          ...[0, 1, 2, 3, 4].map((dayOffset) => ({ shiftId: MORNING, dayOffset, requiredCount: 1 })),
          { shiftId: EVENING, dayOffset: 0, requiredCount: 1 },
          { shiftId: EVENING, dayOffset: 1, requiredCount: 1 },
        ],
        employees: [
          { id: ANNA, name: "Wiśniewska Anna", fte: FULL },
          { id: BARTEK, name: "Kowalski Bartek", fte: FULL },
          { id: CEZARY, name: "Nowak Cezary", fte: { numerator: 1, denominator: 2 } },
        ],
      },
    );

    expect(evaluateSchedule(keeping)).toStrictEqual([]);
    expect(evaluateSchedule(input([]))).toStrictEqual([]);
  });

  it("gives every rule on the scenario, critical ones first, with the key and the reason of each", () => {
    const violations = evaluateSchedule(scenario);

    expect(
      violations.map(({ key, severity, reason, actual, limit, unit }) => ({
        key,
        severity,
        reason,
        actual,
        limit,
        unit,
      })),
    ).toStrictEqual([
      {
        key: `daily_rest|${ANNA}|0:${EVENING}:${ANNA},1:${MORNING}:${ANNA}`,
        severity: "critical",
        reason:
          "Wiśniewska Anna: przerwa 8 h między zmianami Wieczorna (pon. 02.11, 14:00–22:00) i Poranna (wt. 03.11, 06:00–14:00), wymagane co najmniej 11 h.",
        actual: 480,
        limit: 660,
        unit: "minutes",
      },
      {
        key: `daily_hours|${ANNA}|0:${EVENING}:${ANNA}`,
        severity: "critical",
        reason: "Wiśniewska Anna: w dobie liczonej od pon. 02.11, 14:00 przepracowane 16 h, dopuszczalne najwyżej 8 h.",
        actual: 960,
        limit: 480,
        unit: "minutes",
      },
      {
        key: `weekly_hours|${BARTEK}|`,
        severity: "critical",
        reason: `Kowalski Bartek: w tygodniu grafiku (${PERIOD}) łączny czas pracy 56 h, dopuszczalne najwyżej 48 h.`,
        actual: 3360,
        limit: 2880,
        unit: "minutes",
      },
      {
        key: `weekly_rest|${BARTEK}|`,
        severity: "critical",
        reason: `Kowalski Bartek: w tygodniu grafiku (${PERIOD}) najdłuższa przerwa trwa 16 h (od niedz. 08.11, 16:00 do końca grafiku i od początku grafiku do pon. 02.11, 08:00), wymagany odpoczynek tygodniowy co najmniej 35 h.`,
        actual: 960,
        limit: 2100,
        unit: "minutes",
      },
      {
        key: `weekly_norm|${BARTEK}|`,
        severity: "warning",
        reason: `Kowalski Bartek: w tygodniu grafiku (${PERIOD}) łączny czas pracy 56 h, norma tygodniowa (pełny etat) to 40 h.`,
        actual: 3360,
        limit: 2400,
        unit: "minutes",
      },
      {
        key: `weekly_norm|${CEZARY}|`,
        severity: "warning",
        reason: `Nowak Cezary: w tygodniu grafiku (${PERIOD}) łączny czas pracy 40 h, norma tygodniowa (3/4 etatu) to 30 h.`,
        actual: 2400,
        limit: 1800,
        unit: "minutes",
      },
      {
        key: `understaffed|-|0:${DAY}:-`,
        severity: "warning",
        reason: "Brak obsady: zmiana Dzienna (pon. 02.11, 08:00–16:00): przypisano 1 z 3, brakuje 2.",
        actual: 1,
        limit: 3,
        unit: "people",
      },
      {
        key: `understaffed|-|4:${NIGHT}:-`,
        severity: "warning",
        reason: "Brak obsady: zmiana Nocna (pt. 06.11, 22:00–06:00): przypisano 0 z 1, brakuje 1.",
        actual: 0,
        limit: 1,
        unit: "people",
      },
    ]);
    // The complete cell (Tuesday) and the one in surplus (Wednesday) give nothing.
    expect(violations.filter(({ rule }) => rule === "understaffed").map(anchorsOf)).toStrictEqual([
      [`0:${DAY}:-`],
      [`4:${NIGHT}:-`],
    ]);
  });

  it("lists the critical violations before the warnings, the rules in their order, then the employees and the keys", () => {
    const violations = evaluateSchedule(scenario);

    expect([...violations].sort(compareViolations)).toStrictEqual(violations);
    expect(violations.map(({ severity }) => severity)).toStrictEqual([
      "critical",
      "critical",
      "critical",
      "critical",
      "warning",
      "warning",
      "warning",
      "warning",
    ]);
    expect(rulesOf(violations)).toStrictEqual([
      "daily_rest",
      "daily_hours",
      "weekly_hours",
      "weekly_rest",
      "weekly_norm",
      "weekly_norm",
      "understaffed",
      "understaffed",
    ]);
  });

  it("is the four critical rules and the two warnings of the single rules, merged", () => {
    const apart = [
      ...dailyRestViolations(scenario),
      ...dailyHoursViolations(scenario),
      ...weeklyHoursViolations(scenario),
      ...weeklyRestViolations(scenario),
      ...weeklyNormViolations(scenario),
      ...understaffedViolations(scenario),
    ].sort(compareViolations);

    expect(evaluateSchedule(scenario)).toStrictEqual(apart);
  });

  it("has one key for each violation, across all the rules and both severities", () => {
    for (const rules of [scenario, workedCase(3300), input([assignment(DAY, 0, ANNA)], { staffing: [] })]) {
      const violations = evaluateSchedule(rules);

      expect(new Set(keysOf(violations)).size).toBe(violations.length);
    }
    expect(new Set(rulesOf(evaluateSchedule(scenario))).size).toBe(6);
  });

  it("is a new array each time, which nobody else holds", () => {
    const first = evaluateSchedule(scenario);
    first.length = 0;

    const second = evaluateSchedule(scenario);

    expect(second).toHaveLength(8);
    expect(second).not.toBe(first);
    expect(evaluateSchedule(scenario)).not.toBe(second);
  });

  it("gives the same list for any order of the assignments, the shifts, the employees and the staffing", () => {
    const variants = [1, 2, 3, 4, 5, 6].map((seed) => ({
      ...scenario,
      assignments: seededShuffle(scenario.assignments, seed),
      shifts: seededShuffle(scenario.shifts, seed + 100),
      employees: seededShuffle(scenario.employees, seed + 200),
      staffing: seededShuffle(scenario.staffing, seed + 300),
    }));

    expect(expectDeterministic(evaluateSchedule, scenario, { variants })).toHaveLength(8);
  });
});

describe("summarizeViolations", () => {
  const violation = (severity: Violation["severity"]): Violation => ({
    key: severity,
    severity,
    rule: "weekly_norm",
    employeeId: null,
    anchors: [],
    reason: "r",
    actual: 0,
    limit: 0,
    unit: "minutes",
  });

  it("counts the critical violations and the warnings of a result", () => {
    // Seven days of the 8 h shift: the weekly hours and the weekly rest are critical, the norm is a warning.
    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOffset) => assignment(DAY, dayOffset, ANNA));

    const violations = evaluateSchedule(input(week));

    expect(rulesOf(violations)).toStrictEqual(["weekly_hours", "weekly_rest", "weekly_norm"]);
    expect(summarizeViolations(violations)).toStrictEqual({ critical: 2, warning: 1 });
  });

  it.each<{ label: string; violations: Violation[]; counts: { critical: number; warning: number } }>([
    { label: "none", violations: [], counts: { critical: 0, warning: 0 } },
    {
      label: "critical ones only",
      violations: [violation("critical"), violation("critical")],
      counts: { critical: 2, warning: 0 },
    },
    { label: "warnings only", violations: [violation("warning")], counts: { critical: 0, warning: 1 } },
    {
      label: "both, in any order",
      violations: [violation("warning"), violation("critical"), violation("warning")],
      counts: { critical: 1, warning: 2 },
    },
  ])("gives $counts.critical critical and $counts.warning warning for $label", ({ violations, counts }) => {
    expect(summarizeViolations(violations)).toStrictEqual(counts);
  });

  it("leaves the list it counts unchanged", () => {
    const violations = Object.freeze([Object.freeze(violation("warning")), Object.freeze(violation("critical"))]);

    expect(summarizeViolations(violations)).toStrictEqual({ critical: 1, warning: 1 });
    expect(violations.map(({ severity }) => severity)).toStrictEqual(["warning", "critical"]);
  });
});

describe("the shifts that have no hours", () => {
  const rotation = [assignment(DAY, 0, ANNA), assignment(MORNING, 1, ANNA)];
  const unknownEveryDay = [0, 1, 2, 3, 4, 5, 6].map((dayOffset) => assignment(UNKNOWN, dayOffset, ANNA));

  it("are left out by every time rule: a person with nothing else has no violation", () => {
    expect(criticalOf(input(unknownEveryDay))).toStrictEqual([]);
  });

  it("do not change what the other assignments of the person give", () => {
    const withUnknown = input([...unknownEveryDay.slice(0, 3), ...rotation, ...unknownEveryDay.slice(3)]);

    expect(criticalOf(withUnknown)).toStrictEqual(criticalOf(input(rotation)));
    expect(criticalOf(input(rotation))).not.toStrictEqual([]);
  });
});

describe("the people", () => {
  it("are shown by name, and by id when the person is not in the list of employees", () => {
    const rotation = (employeeId: string) => [assignment(DAY, 0, employeeId), assignment(MORNING, 1, employeeId)];

    const known = dailyHoursViolations(input(rotation(BARTEK)));
    const stranger = dailyHoursViolations(input(rotation("ghost-employee")));

    expect(known[0].reason.startsWith("Kowalski Bartek: ")).toBe(true);
    expect(stranger[0].reason.startsWith("ghost-employee: ")).toBe(true);
    expect(stranger[0].employeeId).toBe("ghost-employee");
  });

  it("with no shifts are left out, however many people the schedule has", () => {
    expect(criticalOf(input([], { employees: EMPLOYEES }))).toStrictEqual([]);
    expect(criticalOf(input([assignment(DAY, 0, ANNA)], { employees: [] }))).toStrictEqual([]);
  });
});

describe("the rules together", () => {
  // Anna breaks all four rules, Bartek has the 8 h break of the rules document, Cezary complies (and has a shift without
  // hours and a repeated assignment, which change nothing).
  const roster = input(
    [
      assignment(DAY, 0, ANNA),
      assignment(MORNING, 1, ANNA),
      assignment(LONG, 2, ANNA),
      assignment(EVENING, 2, ANNA),
      assignment(MORNING, 3, ANNA),
      assignment(MORNING, 4, ANNA),
      assignment(DAY, 5, ANNA),
      assignment(DAY, 6, ANNA),
      assignment(EVENING, 0, BARTEK),
      assignment(MORNING, 1, BARTEK),
      assignment(EVENING, 0, BARTEK),
      assignment(DAY, 1, CEZARY),
      assignment(DAY, 3, CEZARY),
      assignment(UNKNOWN, 2, CEZARY),
    ],
    {
      staffing: [
        { shiftId: DAY, dayOffset: 0, requiredCount: 2 },
        { shiftId: NIGHT, dayOffset: 3, requiredCount: 1 },
      ],
    },
  );

  it("find every rule on the roster, for the right people", () => {
    const violations = criticalOf(roster);
    const rulesOfPerson = (employeeId: string) =>
      violations.filter((violation) => violation.employeeId === employeeId).map(({ rule }) => rule);

    expect(new Set(rulesOf(violations))).toStrictEqual(
      new Set<ViolationRule>(["daily_rest", "daily_hours", "weekly_hours", "weekly_rest"]),
    );
    expect(new Set(rulesOfPerson(ANNA))).toStrictEqual(
      new Set<ViolationRule>(["daily_rest", "daily_hours", "weekly_hours", "weekly_rest"]),
    );
    expect(new Set(rulesOfPerson(BARTEK))).toStrictEqual(new Set<ViolationRule>(["daily_rest", "daily_hours"]));
    expect(rulesOfPerson(CEZARY)).toStrictEqual([]);
    expect(violations.every(({ severity, unit }) => severity === "critical" && unit === "minutes")).toBe(true);
  });

  it("are the four rules together in the canonical order", () => {
    const together = criticalOf(roster);
    const apart = [
      ...dailyRestViolations(roster),
      ...dailyHoursViolations(roster),
      ...weeklyHoursViolations(roster),
      ...weeklyRestViolations(roster),
    ].sort(compareViolations);

    expect(together).toStrictEqual(apart);
    expect([...together].sort(compareViolations)).toStrictEqual(together);
    expect(rulesOf(together)).toStrictEqual([...rulesOf(together)].sort((a, b) => RULE_RANK[a] - RULE_RANK[b]));
  });

  it("list each rule in the order of the employee id, then of the key", () => {
    for (const rule of [dailyRestViolations, dailyHoursViolations, weeklyHoursViolations, weeklyRestViolations]) {
      const violations = rule(roster);

      expect([...violations].sort(compareViolations)).toStrictEqual(violations);
      expect(violations.length).toBeGreaterThan(0);
    }
  });

  it("have one key each, and the same finding of the roster has the same key whatever the hours of the shifts", () => {
    const violations = criticalOf(roster);
    // Bartek's break is 9 h instead of 8 h, and Anna's rotation has other numbers too: the findings stay the same.
    const later = SHIFTS.map((shift) =>
      shift.id === MORNING ? { ...shift, startMinute: 420, endMinute: 900 } : shift,
    );
    const changed = criticalOf({ ...roster, shifts: later });

    expect(new Set(keysOf(violations)).size).toBe(violations.length);
    expect(keysOf(violations).every((key) => ALL_RULES.some((rule) => key.startsWith(`${rule}|`)))).toBe(true);
    expect(keysOf(changed)).toStrictEqual(keysOf(violations));
    expect(changed).not.toStrictEqual(violations);
    expect(
      dailyRestViolations({ ...roster, shifts: later }).find(({ employeeId }) => employeeId === BARTEK)?.actual,
    ).toBe(540);
  });

  it("have all six rules with the warnings after every critical violation, for Anna and for the staffing cells", () => {
    const violations = evaluateSchedule(roster);
    const firstWarning = violations.findIndex(({ severity }) => severity === "warning");

    expect(new Set(rulesOf(violations))).toStrictEqual(new Set<ViolationRule>(ALL_RULES));
    expect(violations.slice(0, firstWarning).every(({ severity }) => severity === "critical")).toBe(true);
    expect(violations.slice(firstWarning).every(({ severity }) => severity === "warning")).toBe(true);
    expect(violations.filter(({ rule }) => rule === "weekly_norm").map(({ employeeId }) => employeeId)).toStrictEqual([
      ANNA,
    ]);
    expect(violations.filter(({ rule }) => rule === "understaffed").map(anchorsOf)).toStrictEqual([
      [`0:${DAY}:-`],
      [`3:${NIGHT}:-`],
    ]);
  });

  it("have the same keys on all of the weekly cases: one key per violation and no key twice", () => {
    const violations = [
      ...weeklyRestViolations(roster),
      ...weeklyHoursViolations(roster),
      ...dailyHoursViolations(roster),
    ];

    expect(new Set(keysOf(violations)).size).toBe(violations.length);
  });
});

describe("repeatability of the rules", () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const people = [ANNA, BARTEK, CEZARY];
  const days = [0, 1, 2, 3, 4, 5, 6];
  // About half of the combinations of person, shift and day, in no particular order, plus a repeat and a shift without hours.
  const placed = [DAY, MORNING, EVENING, NIGHT, LONG].flatMap((shiftId, shiftIndex) =>
    people.flatMap((employeeId, personIndex) =>
      days
        .filter((dayOffset) => (shiftIndex + personIndex + dayOffset) % 2 === 0)
        .map((dayOffset) => assignment(shiftId, dayOffset, employeeId)),
    ),
  );
  // Four cells are short, one is complete, one is in surplus and one is of a shift without hours.
  const base = input([...placed, placed[0], placed[7], assignment(UNKNOWN, 1, ANNA), assignment(UNKNOWN, 4, CEZARY)], {
    staffing: [
      { shiftId: DAY, dayOffset: 0, requiredCount: 3 },
      { shiftId: MORNING, dayOffset: 1, requiredCount: 3 },
      { shiftId: NIGHT, dayOffset: 4, requiredCount: 2 },
      { shiftId: EVENING, dayOffset: 3, requiredCount: 1 },
      { shiftId: LONG, dayOffset: 2, requiredCount: 1 },
      { shiftId: UNKNOWN, dayOffset: 5, requiredCount: 2 },
    ],
  });
  const variants = seeds.map((seed) => ({
    ...base,
    assignments: seededShuffle(base.assignments, seed),
    shifts: seededShuffle(base.shifts, seed + 100),
    employees: seededShuffle(base.employees, seed + 200),
    staffing: seededShuffle(base.staffing, seed + 300),
  }));

  it.each<[string, (rules: RuleInput) => Violation[]]>([
    ["every rule", evaluateSchedule],
    ["the four critical rules", criticalOf],
    ["the daily rest", dailyRestViolations],
    ["the daily hours", dailyHoursViolations],
    ["the weekly hours", weeklyHoursViolations],
    ["the weekly rest", weeklyRestViolations],
    ["the weekly norm", weeklyNormViolations],
    ["the staffing", understaffedViolations],
  ])("gives the same result for %s on repeated calls and for any order of the input", (_name, rule) => {
    const violations = expectDeterministic(rule, base, { variants });

    expect(violations.length).toBeGreaterThan(0);
  });

  it("finds all six rules on this input, so that the check above compares something", () => {
    const violations = evaluateSchedule(base);

    expect(new Set(rulesOf(criticalOf(base))).size).toBe(4);
    expect(new Set(rulesOf(violations))).toStrictEqual(new Set<ViolationRule>(ALL_RULES));
    expect(violations.filter(({ rule }) => rule === "understaffed")).toHaveLength(4);
    expect(new Set(keysOf(violations)).size).toBe(violations.length);
  });
});

describe("the input", () => {
  function freeze(source: RuleInput): RuleInput {
    return Object.freeze({
      ...source,
      staffing: Object.freeze(source.staffing.map((cell) => Object.freeze({ ...cell }))),
      assignments: Object.freeze(source.assignments.map((entry) => Object.freeze({ ...entry }))),
      shifts: Object.freeze(source.shifts.map((shift) => Object.freeze({ ...shift }))),
      employees: Object.freeze(
        source.employees.map((employee) => Object.freeze({ ...employee, fte: Object.freeze({ ...employee.fte }) })),
      ),
    });
  }

  it("is left unchanged by every rule, and the frozen arrays are never sorted in place", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOffset) => assignment(DAY, dayOffset, ANNA));
    const source = freeze(
      input(
        [
          assignment(NIGHT, 3, CEZARY),
          assignment(MORNING, 1, ANNA),
          ...week,
          assignment(EVENING, 0, BARTEK),
          assignment(MORNING, 1, BARTEK),
          assignment(UNKNOWN, 2, CEZARY),
          assignment(LONG, 0, CEZARY),
        ],
        { staffing: [{ shiftId: DAY, dayOffset: 0, requiredCount: 2 }] },
      ),
    );
    const before = structuredClone(source);

    const results = [
      evaluateSchedule(source),
      dailyRestViolations(source),
      dailyHoursViolations(source),
      weeklyHoursViolations(source),
      weeklyRestViolations(source),
      weeklyNormViolations(source),
      understaffedViolations(source),
    ];

    expect(structuredClone(source)).toStrictEqual(before);
    // The rules had something to report, so the check above ran them over real findings.
    expect(results.map((violations) => violations.length > 0)).toStrictEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("the time zone", () => {
  it("calls no method of Date that reads or writes the local time", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOffset) => assignment(DAY, dayOffset, ANNA));
    const called = localDateMethodsCalledBy(() => {
      criticalOf(
        input([...week, assignment(NIGHT_LONG, 6, BARTEK), assignment(MORNING, 5, BARTEK)], {
          startDate: "2026-12-29",
        }),
      );
      criticalOf(input(week, { startDate: "2099-12-31" }));
    });

    expect(called).toStrictEqual([]);
  });

  it("calls none of them for the weekly norm and the staffing either, in weeks with holidays and at the edge of the years", () => {
    const called = localDateMethodsCalledBy(() => {
      for (const startDate of ["2026-11-10", "2026-12-24", "2026-12-29", "2099-12-31"]) {
        evaluateSchedule(
          workedCase(3000, { startDate, staffing: [{ shiftId: MORNING, dayOffset: 2, requiredCount: 2 }] }),
        );
        summarizeViolations(weeklyNormViolations(workedCase(2401, { startDate })));
      }
    });

    expect(called).toStrictEqual([]);
  });
});
