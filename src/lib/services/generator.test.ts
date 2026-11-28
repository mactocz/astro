import { describe, expect, it } from "vitest";
import { sortAssignments, summarizeCoverage } from "@/lib/services/assignment";
import {
  formatGenerationSummary,
  formatRemovalSummary,
  generateSchedule,
  type GeneratorInput,
} from "@/lib/services/generator";
import { anchorKey, evaluateSchedule } from "@/lib/services/rules";
import { shiftInterval, type ShiftTimes } from "@/lib/services/work-hours";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import type {
  AbsenceOption,
  AbsenceStatus,
  AssignmentInput,
  Fte,
  GenerationResult,
  StaffingCell,
  ViolationRule,
} from "@/types";

// Monday 2 November 2026, a week without a holiday.
const START_DATE = "2026-11-02";
const DATES = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

function shift(id: string, from: number, to: number): ShiftTimes {
  return { id, name: id, startMinute: from * 60, endMinute: to * 60 };
}

const MORNING = shift("morning", 6, 14);
const DAY = shift("day", 8, 16);
const EVENING = shift("evening", 14, 22);
const NIGHT = shift("night", 22, 6);
const LONG = shift("long", 8, 17);
const HUGE = shift("huge", 7, 20);
const SIX = shift("six", 6, 12);
const EARLY = shift("early", 6, 10);
const LATE = shift("late", 18, 22);
const AFTER_MIDNIGHT = shift("after-midnight", 0, 6);
const TOWARDS_EVENING = shift("towards-evening", 17, 21);
const LATE_MORNING = shift("late-morning", 8, 13);
const FIRST_HOUR = shift("first-hour", 0, 1);
// The times of `DAY` and an id that sorts after it.
const TWIN = shift("twin", 8, 16);
const SHIFTS = [
  TWIN,
  MORNING,
  DAY,
  EVENING,
  NIGHT,
  LONG,
  HUGE,
  SIX,
  EARLY,
  LATE,
  AFTER_MIDNIGHT,
  TOWARDS_EVENING,
  LATE_MORNING,
  FIRST_HOUR,
];

const FULL: Fte = { numerator: 1, denominator: 1 };
const HALF: Fte = { numerator: 1, denominator: 2 };
// A norm of 5 h, so that any 8 h shift is above it.
const EIGHTH: Fte = { numerator: 1, denominator: 8 };

const person = (id: string, fte: Fte = FULL) => ({ id, name: `Osoba ${id}`, fte });

const on = (employeeId: string, { id }: ShiftTimes, dayOffset: number): AssignmentInput => ({
  shiftId: id,
  dayOffset,
  employeeId,
});

const cell = ({ id }: ShiftTimes, dayOffset: number, requiredCount = 1): StaffingCell => ({
  shiftId: id,
  dayOffset,
  requiredCount,
});

function absence(employeeId: string, from: number, to: number, status: AbsenceStatus = "approved"): AbsenceOption {
  return { employeeId, type: "vacation", status, startDate: DATES[from], endDate: DATES[to] };
}

// An input whose roster is everybody listed, unless `extra` says otherwise.
function input(employees: ReturnType<typeof person>[], extra: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    startDate: START_DATE,
    staffing: [],
    assignments: [],
    shifts: SHIFTS,
    employees,
    employeeIds: employees.map(({ id }) => id),
    absences: [],
    ...extra,
  };
}

// The critical rules that the rules report once the assignments are added to the input.
function criticalRules(data: GeneratorInput, ...added: AssignmentInput[]): ViolationRule[] {
  const violations = evaluateSchedule({ ...data, staffing: [], assignments: [...data.assignments, ...added] });
  return [...new Set(violations.filter(({ severity }) => severity === "critical").map(({ rule }) => rule))];
}

const criticalKeys = (data: GeneratorInput, assignments: readonly AssignmentInput[]): string[] =>
  evaluateSchedule({ ...data, assignments })
    .filter(({ severity }) => severity === "critical")
    .map(({ key }) => key);

const peopleOf = ({ additions }: GenerationResult): string[] => additions.map(({ employeeId }) => employeeId);

describe("generateSchedule: filling the shortages", () => {
  it("fills the whole grid when nothing is in the way", () => {
    const staffing = [0, 1, 2, 3, 4].flatMap((day) => [cell(MORNING, day, 2), cell(EVENING, day)]);
    const data = input([person("a"), person("b"), person("c"), person("d")], { staffing });

    const result = generateSchedule(data);

    expect(result.missing).toBe(0);
    expect(result.additions).toHaveLength(15);
    expect(result.overNormEmployeeIds).toStrictEqual([]);
    expect(result.onRequestedAbsence).toStrictEqual([]);
    expect(result.additions).toStrictEqual(sortAssignments(result.additions));
    expect(summarizeCoverage(staffing, result.additions).every(({ missing, surplus }) => missing + surplus === 0)).toBe(
      true,
    );
    expect(criticalKeys(data, result.additions)).toStrictEqual([]);
  });

  it("never goes above the required count, and leaves a cell with a surplus alone", () => {
    const data = input([person("a"), person("b"), person("c")], {
      staffing: [cell(MORNING, 0), cell(MORNING, 2)],
      assignments: [on("a", MORNING, 2), on("b", MORNING, 2)],
    });

    const result = generateSchedule(data);

    expect(result.additions).toStrictEqual([on("c", MORNING, 0)]);
    expect(result.missing).toBe(0);
  });

  it("assigns only people of the roster", () => {
    const data = input([person("a"), person("b")], { staffing: [cell(MORNING, 0, 2)], employeeIds: ["b"] });

    const result = generateSchedule(data);

    expect(result.additions).toStrictEqual([on("b", MORNING, 0)]);
    expect(result.missing).toBe(1);
  });

  it("does not add a person to a cell they are on already", () => {
    const data = input([person("a")], { staffing: [cell(MORNING, 0, 2)], assignments: [on("a", MORNING, 0)] });

    expect(generateSchedule(data)).toMatchObject({ additions: [], missing: 1 });
  });

  it("leaves a cell of a shift outside the dictionary short", () => {
    const data = input([person("a")], { staffing: [cell(shift("gone", 6, 14), 0, 2), cell(MORNING, 1)] });

    const result = generateSchedule(data);

    expect(result.additions).toStrictEqual([on("a", MORNING, 1)]);
    expect(result.missing).toBe(2);
  });
});

describe("generateSchedule: no new critical violation", () => {
  const sixDays = (of: ShiftTimes) => [0, 1, 2, 3, 4, 5].map((day) => on("a", of, day));

  it.each([
    {
      name: "the daily rest",
      assignments: [on("a", LATE, 0)],
      target: on("a", EARLY, 1),
      rules: ["daily_rest"],
    },
    { name: "8 h in a day", assignments: [], target: on("a", LONG, 0), rules: ["daily_hours"] },
    {
      name: "48 h in a week",
      assignments: sixDays(MORNING),
      target: on("a", MORNING, 6),
      rules: ["weekly_hours", "weekly_rest"],
    },
    { name: "the weekly rest", assignments: sixDays(SIX), target: on("a", SIX, 6), rules: ["weekly_rest"] },
  ])("leaves the cell short when the only candidate would break $name", ({ assignments, target, rules }) => {
    const data = input([person("a")], {
      staffing: [{ shiftId: target.shiftId, dayOffset: target.dayOffset, requiredCount: 1 }],
      assignments,
    });

    expect(criticalRules(data)).toStrictEqual([]);
    expect(criticalRules(data, target)).toStrictEqual(rules);
    expect(generateSchedule(data)).toMatchObject({ additions: [], missing: 1 });
  });

  it("leaves the cell short when the only candidate is on an approved absence", () => {
    const data = input([person("a")], { staffing: [cell(MORNING, 2)], absences: [absence("a", 2, 3)] });

    expect(criticalRules(data, on("a", MORNING, 2))).toStrictEqual(["absence"]);
    expect(generateSchedule(data)).toMatchObject({ additions: [], missing: 1 });
  });

  it("still assigns a person whose existing violation the addition has nothing to do with", () => {
    const data = input([person("a")], {
      staffing: [cell(MORNING, 4)],
      assignments: [on("a", LATE, 0), on("a", EARLY, 1)],
    });

    expect(criticalRules(data)).toStrictEqual(["daily_rest"]);
    expect(generateSchedule(data).additions).toStrictEqual([on("a", MORNING, 4)]);
  });
});

describe("generateSchedule: a person over a limit gets nothing", () => {
  // The blocked person "a" is alone on the cell first, then next to a clean person, who shows that the cell can be filled.
  function expectNothingFor(assignments: AssignmentInput[], target: ShiftTimes, day: number) {
    const staffing = [cell(target, day, 2)];
    const alone = input([person("a")], { staffing, assignments });
    expect(generateSchedule(alone)).toMatchObject({ additions: [], missing: 2 });
    const withAnother = input([person("a"), person("b")], { staffing, assignments });
    expect(generateSchedule(withAnother).additions).toStrictEqual([on("b", target, day)]);
  }

  it("daily_hours, also when the new breach would give no finding of its own", () => {
    // 00:00-06:00 and 17:00-21:00 on day 0, then 08:00-13:00 on day 1: the 24 h from 17:00 hold 9 h, but that window opens
    // inside the reported one, so the rules say nothing new.
    const assignments = [on("a", AFTER_MIDNIGHT, 0), on("a", TOWARDS_EVENING, 0)];
    const data = input([person("a")], { assignments });
    expect(criticalRules(data)).toStrictEqual(["daily_hours"]);
    expect(criticalKeys(data, [...assignments, on("a", LATE_MORNING, 1)])).toStrictEqual(
      criticalKeys(data, assignments),
    );

    expectNothingFor(assignments, LATE_MORNING, 1);
  });

  it("weekly_hours", () => {
    const assignments = [0, 1, 2, 3].map((day) => on("a", HUGE, day));
    expect(criticalRules(input([person("a")], { assignments }))).toContain("weekly_hours");

    expectNothingFor(assignments, MORNING, 5);
  });

  it("weekly_rest, also when the addition would make the finding disappear", () => {
    // Shifts of 6 h that start an hour or two later each day: 30 h before the first and 3 h after the last make 33 h across
    // the edge. An hour at midnight of day 0 would leave 29 h before the next shift, a break after a change of shift.
    const drifting = [6, 8, 10, 12, 14, 15].map((hour, index) => ({
      of: shift(`drift-${index}`, hour, hour + 6),
      day: index + 1,
    }));
    const shifts = [...SHIFTS, ...drifting.map(({ of }) => of)];
    const assignments = drifting.map(({ of, day }) => on("a", of, day));
    const data = input([person("a")], { shifts, assignments });
    expect(criticalRules(data)).toStrictEqual(["weekly_rest"]);
    expect(criticalRules(data, on("a", FIRST_HOUR, 0))).toStrictEqual([]);

    const staffing = [cell(FIRST_HOUR, 0)];
    expect(generateSchedule({ ...data, staffing })).toMatchObject({ additions: [], missing: 1 });
  });
});

describe("generateSchedule: the tiers", () => {
  // The ids run against the tiers, so that the lowest id never explains the choice.
  const BOTH = "p1";
  const REQUEST = "p2";
  const OVER = "p3";
  const CLEAN = "p4";
  const people = [person(BOTH, EIGHTH), person(REQUEST), person(OVER, EIGHTH), person(CLEAN)];
  const absences = [absence(BOTH, 2, 2, "requested"), absence(REQUEST, 2, 2, "requested")];
  const generate = (required: number) =>
    generateSchedule(input(people, { staffing: [cell(MORNING, 2, required)], absences }));

  it("takes a clean person first, then one over the norm, then one with a request, then one with both", () => {
    expect(peopleOf(generate(1))).toStrictEqual([CLEAN]);
    expect(peopleOf(generate(2))).toStrictEqual([OVER, CLEAN]);
    expect(peopleOf(generate(3))).toStrictEqual([REQUEST, OVER, CLEAN]);
    expect(peopleOf(generate(4))).toStrictEqual([BOTH, REQUEST, OVER, CLEAN]);
  });

  it("reports the people over the norm and the additions on a requested absence", () => {
    expect(generate(1)).toMatchObject({ overNormEmployeeIds: [], onRequestedAbsence: [] });
    expect(generate(2)).toMatchObject({ overNormEmployeeIds: [OVER], onRequestedAbsence: [] });
    expect(generate(4)).toMatchObject({
      missing: 0,
      overNormEmployeeIds: [BOTH, OVER],
      onRequestedAbsence: [on(BOTH, MORNING, 2), on(REQUEST, MORNING, 2)],
    });
  });

  it("reports only what the additions brought, not what was there before", () => {
    const data = input([person("a", EIGHTH), person("b")], {
      staffing: [cell(MORNING, 0), cell(MORNING, 2)],
      assignments: [on("a", MORNING, 0)],
      absences: [absence("a", 0, 0, "requested")],
    });

    expect(generateSchedule(data)).toStrictEqual({
      additions: [on("b", MORNING, 2)],
      missing: 0,
      overNormEmployeeIds: [],
      onRequestedAbsence: [],
    });
  });

  it("fills the cells of a lower tier before it looks at a higher one", () => {
    // One person cannot take both cells. The earlier one falls on a request, so the later, clean one is filled instead.
    const data = input([person("a")], {
      staffing: [cell(EVENING, 0), cell(MORNING, 1)],
      absences: [absence("a", 0, 0, "requested")],
    });

    expect(generateSchedule(data)).toMatchObject({
      additions: [on("a", MORNING, 1)],
      missing: 1,
      onRequestedAbsence: [],
    });
  });
});

describe("generateSchedule: the choice of the cell and of the person", () => {
  it("fills the cell with the fewest candidates to spare first", () => {
    // Evening of day 0 and morning of day 1 cannot both go to one person, and only "a" can take the second.
    const data = input([person("a"), person("b")], {
      staffing: [cell(EVENING, 0), cell(MORNING, 1)],
      absences: [absence("b", 1, 1)],
    });

    expect(generateSchedule(data).additions).toStrictEqual([on("b", EVENING, 0), on("a", MORNING, 1)]);
  });

  it.each([
    { name: "the earlier day", first: cell(EVENING, 0), second: cell(MORNING, 1) },
    { name: "the earlier start", first: cell(MORNING, 0), second: cell(DAY, 0) },
    { name: "the lower shift id", first: cell(DAY, 0), second: cell(TWIN, 0) },
  ])("breaks a tie between cells by $name", ({ first, second }) => {
    const data = input([person("a")], { staffing: [second, first] });

    expect(generateSchedule(data).additions).toStrictEqual([
      { shiftId: first.shiftId, dayOffset: first.dayOffset, employeeId: "a" },
    ]);
  });

  it("spreads the work by the FTE and breaks a tie by id", () => {
    const staffing = [0, 1, 2, 3, 4, 5].map((day) => cell(SIX, day));
    const data = input([person("b", HALF), person("a")], { staffing });

    const result = generateSchedule(data);

    const daysOf = (id: string) =>
      result.additions.filter(({ employeeId }) => employeeId === id).map(({ dayOffset }) => dayOffset);
    expect(daysOf("a")).toStrictEqual([0, 2, 4, 5]);
    expect(daysOf("b")).toStrictEqual([1, 3]);
  });

  it("takes the lower id when everything else is equal", () => {
    const data = input([person("b"), person("a")], { staffing: [cell(MORNING, 0)] });

    expect(peopleOf(generateSchedule(data))).toStrictEqual(["a"]);
  });

  it("counts the existing assignments into the load and does not list them", () => {
    const data = input([person("a"), person("b")], {
      staffing: [cell(MORNING, 0), cell(MORNING, 3)],
      assignments: [on("a", MORNING, 0)],
    });

    expect(generateSchedule(data).additions).toStrictEqual([on("b", MORNING, 3)]);
  });

  it("takes fewer minutes when the use of the norm is equal", () => {
    // 16 h of 40 h and 8 h of 20 h are both 40%.
    const data = input([person("a"), person("b", HALF)], {
      staffing: [cell(MORNING, 4)],
      assignments: [on("a", MORNING, 0), on("a", MORNING, 1), on("b", MORNING, 0)],
    });

    expect(peopleOf(generateSchedule(data))).toStrictEqual(["b"]);
  });

  it("takes a person with a norm of 0 last", () => {
    // "a" is on leave from Monday to Friday, so their norm is 0; "b" is far above a norm of 5 h already.
    const data = input([person("a"), person("b", EIGHTH)], {
      staffing: [cell(MORNING, 5)],
      assignments: [on("b", MORNING, 0)],
      absences: [absence("a", 0, 4)],
    });

    expect(peopleOf(generateSchedule(data))).toStrictEqual(["b"]);
  });
});

// A pseudo-random week from a seed: some people, shifts of several lengths, a staffing grid, assignments made by hand
// (which break rules often) and absences of every status.
function randomWeek(seed: number): GeneratorInput {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const ftes = seededShuffle([FULL, FULL, FULL, FULL, HALF, EIGHTH], seed);
  const people = ids.map((id, index) => person(id, ftes[index]));
  const shifts = [MORNING, DAY, EVENING, NIGHT, SIX, EARLY, LATE, AFTER_MIDNIGHT, TOWARDS_EVENING, LATE_MORNING];
  const days = [0, 1, 2, 3, 4, 5, 6];
  const cells = days.flatMap((day) => shifts.map((of) => ({ of, day })));
  const entries = ids.flatMap((id) => cells.map(({ of, day }) => on(id, of, day)));
  const statuses: AbsenceStatus[] = ["approved", "requested", "rejected"];
  return input(people, {
    shifts,
    staffing: seededShuffle(cells, seed + 1)
      .slice(0, 30)
      .map(({ of, day }, index) => cell(of, day, 1 + (index % 3))),
    assignments: seededShuffle(entries, seed + 2).slice(0, seed % 15),
    absences: seededShuffle(ids, seed + 3)
      .slice(0, 3)
      .map((id, index) => {
        const from = (seed + index * 2) % 6;
        return absence(id, from, from + 1, statuses[index]);
      }),
  });
}

function shuffled(data: GeneratorInput, seed: number): GeneratorInput {
  return {
    ...data,
    staffing: seededShuffle(data.staffing, seed),
    assignments: seededShuffle(data.assignments, seed),
    shifts: seededShuffle(data.shifts, seed),
    employees: seededShuffle(data.employees, seed),
    employeeIds: seededShuffle(data.employeeIds, seed),
    absences: seededShuffle(data.absences ?? [], seed),
  };
}

// The most minutes of work in a 24 h window that opens at the start of a shift of the person and holds some of `added`.
// Counted here on its own, with no window skipped, as a check of what the daily rule lets through.
function busiestDayAround(data: GeneratorInput, added: AssignmentInput, assignments: AssignmentInput[]): number {
  const intervalOf = ({ shiftId, dayOffset }: AssignmentInput) => {
    const of = data.shifts.find(({ id }) => id === shiftId);
    if (of === undefined) {
      throw new Error(`no shift ${shiftId}`);
    }
    return shiftInterval(of, dayOffset);
  };
  const own = assignments.filter(({ employeeId }) => employeeId === added.employeeId).map(intervalOf);
  const target = intervalOf(added);
  const inside = (interval: { start: number; end: number }, from: number) =>
    Math.max(0, Math.min(interval.end, from + 1440) - Math.max(interval.start, from));
  return Math.max(
    0,
    ...own
      .filter(({ start }) => inside(target, start) > 0)
      .map(({ start }) => own.reduce((sum, interval) => sum + inside(interval, start), 0)),
  );
}

describe("generateSchedule: on many weeks", () => {
  const seeds = Array.from({ length: 40 }, (_unused, index) => index + 1);

  // Many whole weeks are generated, so the test gets more time than the default for a slow machine.
  it("adds no critical violation, no surplus and no day of more than 8 h", { timeout: 20_000 }, () => {
    let added = 0;
    let startedWithCritical = 0;
    for (const seed of seeds) {
      const data = randomWeek(seed);
      const { additions, missing } = generateSchedule(data);
      const all = [...data.assignments, ...additions];
      const before = new Set(criticalKeys(data, data.assignments));
      added += additions.length;
      startedWithCritical += before.size > 0 ? 1 : 0;

      expect(
        criticalKeys(data, all).filter((key) => !before.has(key)),
        `seed ${seed}`,
      ).toStrictEqual([]);
      const addedKeys = new Set(additions.map(anchorKey));
      const onAdditions = evaluateSchedule({ ...data, assignments: all }).filter(
        ({ severity, anchors }) => severity === "critical" && anchors.some((a) => addedKeys.has(anchorKey(a))),
      );
      expect(onAdditions, `seed ${seed}`).toStrictEqual([]);
      for (const addition of additions) {
        expect(busiestDayAround(data, addition, all), `seed ${seed}`).toBeLessThanOrEqual(480);
      }

      expect(new Set(all.map(anchorKey)).size, `seed ${seed}`).toBe(all.length);
      const was = summarizeCoverage(data.staffing, data.assignments);
      const is = summarizeCoverage(data.staffing, all);
      is.forEach(({ assigned, required }, index) => {
        expect(assigned, `seed ${seed}`).toBeLessThanOrEqual(Math.max(required, was[index].assigned));
      });
      expect(missing, `seed ${seed}`).toBe(is.reduce((sum, entry) => sum + entry.missing, 0));
    }
    // The checks above mean something only if the generator had work to do and existing violations to leave as they were.
    expect(added).toBeGreaterThan(500);
    expect(startedWithCritical).toBeGreaterThan(10);
  });

  it("gives the same result whatever the order of the input", () => {
    for (const seed of [3, 14, 27]) {
      const data = randomWeek(seed);
      const result = expectDeterministic(generateSchedule, data, {
        runs: 2,
        variants: [1, 2, 3].map((variant) => shuffled(data, seed * 10 + variant)),
      });
      expect(result.additions.length).toBeGreaterThan(0);
    }
  });

  it("only reads its input", () => {
    const data = randomWeek(14);
    const copy = structuredClone(data);

    generateSchedule(data);

    expect(data).toStrictEqual(copy);
  });

  it("proposes 30 people for 100 cells in under 3 s", () => {
    const people = Array.from({ length: 30 }, (_unused, index) => person(`p${index}`, index % 5 === 0 ? HALF : FULL));
    const shifts = Array.from({ length: 15 }, (_unused, index) => shift(`s${index}`, 5 + index, 13 + index));
    const staffing = shifts.flatMap((of) => [0, 1, 2, 3, 4, 5, 6].map((day) => cell(of, day, 2))).slice(0, 100);
    const data = input(people, { shifts, staffing });

    const startedAt = Date.now();
    const result = generateSchedule(data);
    const elapsed = Date.now() - startedAt;

    expect(result.additions.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("formatGenerationSummary", () => {
  const result = (extra: Partial<GenerationResult>): GenerationResult => ({
    additions: [],
    missing: 0,
    overNormEmployeeIds: [],
    onRequestedAbsence: [],
    ...extra,
  });
  const additions = [on("a", MORNING, 0), on("b", MORNING, 0)];

  it("says that the staffing is full already", () => {
    expect(formatGenerationSummary(result({}))).toStrictEqual(["Obsada jest już pełna, nie ma czego dodać."]);
  });

  it("says that nobody can be added", () => {
    expect(formatGenerationSummary(result({ missing: 3 }))).toStrictEqual([
      "Nie można nikogo dodać: nikt z grafiku nie może objąć brakujących zmian bez krytycznego naruszenia.",
      "Brakuje osób: 3.",
    ]);
  });

  it("counts the additions when the staffing becomes full", () => {
    expect(formatGenerationSummary(result({ additions }))).toStrictEqual([
      "Dodane przypisania: 2.",
      "Obsada jest pełna.",
    ]);
  });

  it("names the shortage, the people over the norm and the requested absences", () => {
    const summary = result({
      additions,
      missing: 1,
      overNormEmployeeIds: ["a"],
      onRequestedAbsence: [on("b", MORNING, 0)],
    });

    expect(formatGenerationSummary(summary)).toStrictEqual([
      "Dodane przypisania: 2.",
      "Nadal brakuje osób: 1.",
      "Osoby z dodanymi zmianami ponad normę tygodniową: 1.",
      "Przypisania mimo niezatwierdzonego wniosku o nieobecność: 1.",
    ]);
  });
});

describe("formatRemovalSummary", () => {
  it("counts what was removed", () => {
    expect(formatRemovalSummary(3)).toBe("Usunięte wygenerowane przypisania: 3.");
  });

  it("says that there was nothing left to remove", () => {
    expect(formatRemovalSummary(0)).toBe("Nie było już wygenerowanych przypisań do usunięcia.");
  });
});
