import { describe, expect, it } from "vitest";
import {
  employeeDayKey,
  groupByEmployeeDay,
  readGenerationRequest,
  sortAssignments,
  summarizeCoverage,
  validateAssignmentInput,
} from "@/lib/services/assignment";
import { PERIOD_DAYS } from "@/lib/services/schedule";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import type { Assignment, AssignmentField, AssignmentFieldErrors, AssignmentInput, CoverageCell } from "@/types";

// Shifts (the shift dictionary) and employees are referred to by id only. By id the shifts order as NIGHT, MORNING, NOON
// and the employees as ANNA, BARTEK, CEZARY, which is not the order of the names, so only a sort by id can produce it.
const NIGHT = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";
const MORNING = "5f1c9a3e-2b7d-4e60-8c14-9a0d3e7b1f25";
const NOON = "a3d7e1f4-6c52-4b98-8e0a-1f9c2d5b7a36";
const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const CEZARY = "c0ffee00-1111-4222-8333-444455556666";
// A shift that no staffing grid below has a cell for.
const OTHER_SHIFT = "00000000-0000-4000-8000-000000000001";

const validInput = { shiftId: NIGHT, dayOffset: 2, employeeId: ANNA };

function validate(overrides: Record<string, unknown> = {}) {
  return validateAssignmentInput({ ...validInput, ...overrides });
}

function validValue(overrides: Record<string, unknown> = {}): AssignmentInput {
  const result = validate(overrides);
  if (!result.ok) {
    throw new Error(`expected valid input, got errors for ${Object.keys(result.errors).join(", ")}`);
  }
  return result.value;
}

function errorsOf(overrides: Record<string, unknown> = {}): AssignmentFieldErrors {
  const result = validate(overrides);
  if (result.ok) {
    throw new Error(`expected invalid input, got ${JSON.stringify(result.value)}`);
  }
  return result.errors;
}

// Exactly one field is rejected, with a single non-empty message.
function expectOnlyError(overrides: Record<string, unknown>, field: AssignmentField) {
  const errors = errorsOf(overrides);
  expect(Object.keys(errors)).toStrictEqual([field]);
  expect(errors[field]?.trim().length).toBeGreaterThan(0);
}

function assignment(shiftId: string, dayOffset: number, employeeId: string): AssignmentInput {
  return { shiftId, dayOffset, employeeId };
}

const keysOf = (list: readonly AssignmentInput[]) =>
  list.map(({ shiftId, dayOffset, employeeId }) => `${shiftId}/${dayOffset}/${employeeId}`);

describe("validateAssignmentInput", () => {
  it("accepts a valid assignment and gives back the three fields", () => {
    expect(validate()).toStrictEqual({ ok: true, value: { shiftId: NIGHT, dayOffset: 2, employeeId: ANNA } });
  });

  it("leaves out other keys, such as a source or an id, instead of passing them through", () => {
    expect(validValue({ source: "generated", id: "x" })).toStrictEqual({
      shiftId: NIGHT,
      dayOffset: 2,
      employeeId: ANNA,
    });
  });

  it("copies the values instead of passing the input object through", () => {
    const input = { ...validInput };

    const result = validateAssignmentInput(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBe(input);
    }
  });

  it("keeps both ids in lower case when they are written in upper case", () => {
    const value = validValue({ shiftId: NIGHT.toUpperCase(), employeeId: ANNA.toUpperCase() });

    expect(value).toStrictEqual({ shiftId: NIGHT, dayOffset: 2, employeeId: ANNA });
  });

  it.each([0, 1, 3, PERIOD_DAYS - 1])("accepts day offset %d", (dayOffset) => {
    expect(validValue({ dayOffset }).dayOffset).toBe(dayOffset);
  });

  it("turns a negative zero day offset from JSON into zero", () => {
    const raw: unknown = JSON.parse(`{"shiftId":"${NIGHT}","dayOffset":-0,"employeeId":"${ANNA}"}`);

    const result = validateAssignmentInput(raw);

    expect(result.ok && Object.is(result.value.dayOffset, 0)).toBe(true);
  });
});

describe("validateAssignmentInput day offset", () => {
  it.each<[string, unknown]>([
    ["-1", -1],
    ["7", PERIOD_DAYS],
    ["a large number", 100],
    ["1.5", 1.5],
    ["the string 2", "2"],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["null", null],
    ["a missing value", undefined],
    ["true", true],
    ["an array holding a day", [2]],
  ])("rejects a day offset of %s", (_label, dayOffset) => {
    expectOnlyError({ dayOffset }, "dayOffset");
  });
});

describe.each<[AssignmentField]>([["shiftId"], ["employeeId"]])("validateAssignmentInput %s", (field) => {
  const idOf = (value: AssignmentInput) => value[field];

  it("accepts an id in lower case and one in mixed case, and keeps it in lower case", () => {
    expect(idOf(validValue({ [field]: CEZARY }))).toBe(CEZARY);
    expect(idOf(validValue({ [field]: "C0FFEE00-1111-4222-8333-444455556666" }))).toBe(CEZARY);
  });

  it.each<[string, unknown]>([
    ["text that is not an id", "not-a-uuid"],
    ["an empty string", ""],
    ["an id with a trailing newline", `${CEZARY}\n`],
    ["an id with a leading space", ` ${CEZARY}`],
    ["an id with a character missing", CEZARY.slice(1)],
    ["an id with a character too many", `${CEZARY}0`],
    ["an id without hyphens", CEZARY.replaceAll("-", "")],
    ["an id with a letter outside hexadecimal", CEZARY.replace("c", "g")],
    ["a number", 7],
    ["null", null],
    ["a missing value", undefined],
    ["an object holding an id", { id: CEZARY }],
    ["an array holding an id", [CEZARY]],
  ])("rejects an id that is %s", (_label, value) => {
    expectOnlyError({ [field]: value }, field);
  });
});

describe("validateAssignmentInput errors", () => {
  const allBad = { shiftId: "x", dayOffset: 7, employeeId: "y" };

  it("returns every invalid field at once", () => {
    const errors = errorsOf(allBad);

    expect(Object.keys(errors).sort()).toStrictEqual(["dayOffset", "employeeId", "shiftId"]);
    for (const message of Object.values(errors)) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives each field its own message", () => {
    expect(new Set(Object.values(errorsOf(allBad))).size).toBe(3);
  });

  it("reports one bad field next to two good ones", () => {
    expectOnlyError({ employeeId: "y" }, "employeeId");
    expectOnlyError({ shiftId: "x" }, "shiftId");
    expectOnlyError({ dayOffset: 7 }, "dayOffset");
  });

  it("words the three fields differently", () => {
    const messages = [
      errorsOf({ shiftId: "x" }).shiftId,
      errorsOf({ dayOffset: 7 }).dayOffset,
      errorsOf({ employeeId: "y" }).employeeId,
    ];

    expect(new Set(messages).size).toBe(3);
  });

  it("uses one message per field, whatever the cause", () => {
    expect(errorsOf({ dayOffset: -1 }).dayOffset).toBe(errorsOf({ dayOffset: "2" }).dayOffset);
    expect(errorsOf({ shiftId: null }).shiftId).toBe(errorsOf({ shiftId: "x" }).shiftId);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string", NIGHT],
    ["a number", 42],
    ["a boolean", true],
    ["an array", []],
    ["an empty object", {}],
  ])("treats %s as empty fields and reports all of them", (_label, raw) => {
    const result = validateAssignmentInput(raw);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toStrictEqual(["dayOffset", "employeeId", "shiftId"]);
    }
  });
});

describe("validateAssignmentInput repeatability", () => {
  it("gives the same result for repeated calls and for another spelling of the same data", () => {
    const variants = [
      // Letter case of the ids.
      { ...validInput, shiftId: NIGHT.toUpperCase(), employeeId: ANNA.toUpperCase() },
      // Key order, written out and shuffled.
      { employeeId: ANNA, dayOffset: 2, shiftId: NIGHT },
      ...[1, 2, 3].map((seed) => Object.fromEntries(seededShuffle(Object.entries(validInput), seed))),
    ];

    const result = expectDeterministic(validateAssignmentInput, validInput, { variants });

    expect(result).toStrictEqual({ ok: true, value: { shiftId: NIGHT, dayOffset: 2, employeeId: ANNA } });
  });

  it("gives the same errors for repeated calls and for key order", () => {
    const variants = [1, 2, 3].map((seed) =>
      Object.fromEntries(seededShuffle(Object.entries({ shiftId: "x", dayOffset: 7, employeeId: "y" }), seed)),
    );

    const result = expectDeterministic(
      validateAssignmentInput,
      { shiftId: "x", dayOffset: 7, employeeId: "y" },
      { variants },
    );

    expect(result.ok).toBe(false);
  });

  it("does not change its input", () => {
    const input = structuredClone(validInput);
    const before = structuredClone(input);

    validateAssignmentInput(input);

    expect(input).toStrictEqual(before);
  });
});

describe("readGenerationRequest", () => {
  const body = { basis: "abc", assignments: [validInput], additions: [assignment(MORNING, 0, BARTEK)] };

  it("reads the fingerprint, the assignments of the page and the ones to add", () => {
    expect(readGenerationRequest(body)).toStrictEqual(body);
  });

  it("accepts a page with no assignments", () => {
    expect(readGenerationRequest({ ...body, assignments: [] })).toStrictEqual({ ...body, assignments: [] });
  });

  it("normalises every item and leaves out other keys", () => {
    const raw = {
      ...body,
      assignments: [{ ...validInput, shiftId: NIGHT.toUpperCase(), source: "manual" }],
      additions: [{ ...assignment(MORNING, 0, BARTEK.toUpperCase()), source: "manual" }],
      confirmedKeys: ["x"],
    };

    expect(readGenerationRequest(raw)).toStrictEqual(body);
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["null", null],
    ["a string", "body"],
    ["a list", [body]],
    ["a body without a fingerprint", { ...body, basis: undefined }],
    ["a fingerprint that is not text", { ...body, basis: 1 }],
    ["a body without the assignments of the page", { ...body, assignments: undefined }],
    ["assignments that are not a list", { ...body, assignments: validInput }],
    ["an assignment of the page that is not valid", { ...body, assignments: [{ ...validInput, dayOffset: 7 }] }],
    ["a body without additions", { ...body, additions: undefined }],
    ["additions that are not a list", { ...body, additions: validInput }],
    ["an empty list of additions", { ...body, additions: [] }],
    ["one invalid addition among valid ones", { ...body, additions: [validInput, { ...validInput, shiftId: "x" }] }],
    ["an addition that is null", { ...body, additions: [null] }],
  ])("refuses %s", (_label, raw) => {
    expect(readGenerationRequest(raw)).toBeNull();
  });
});

describe("sortAssignments", () => {
  // Out of order on purpose; the shift decides first, then the day, then the employee.
  const list: Assignment[] = [
    { shiftId: MORNING, dayOffset: 1, employeeId: ANNA, source: "manual" },
    { shiftId: NIGHT, dayOffset: 6, employeeId: CEZARY, source: "generated" },
    { shiftId: MORNING, dayOffset: 0, employeeId: BARTEK, source: "manual" },
    { shiftId: NIGHT, dayOffset: 6, employeeId: ANNA, source: "manual" },
    { shiftId: MORNING, dayOffset: 0, employeeId: ANNA, source: "generated" },
  ];

  it("orders by shift id, then day, then employee id", () => {
    expect(keysOf(sortAssignments(list))).toStrictEqual([
      `${NIGHT}/6/${ANNA}`,
      `${NIGHT}/6/${CEZARY}`,
      `${MORNING}/0/${ANNA}`,
      `${MORNING}/0/${BARTEK}`,
      `${MORNING}/1/${ANNA}`,
    ]);
  });

  it("puts an earlier shift id first even when its day is later", () => {
    expect(keysOf(sortAssignments([assignment(MORNING, 0, ANNA), assignment(NIGHT, 6, ANNA)]))).toStrictEqual([
      `${NIGHT}/6/${ANNA}`,
      `${MORNING}/0/${ANNA}`,
    ]);
  });

  it("keeps the other fields of a full assignment", () => {
    const [first] = sortAssignments(list);

    expect(first).toStrictEqual({ shiftId: NIGHT, dayOffset: 6, employeeId: ANNA, source: "manual" });
  });

  it("gives an empty list for an empty list", () => {
    expect(sortAssignments([])).toStrictEqual([]);
  });

  it("returns a new array and leaves the input unchanged", () => {
    const input = Object.freeze(seededShuffle(list, 7));
    const before = structuredClone(input);

    const sorted = sortAssignments(input);

    expect(sorted).not.toBe(input);
    expect(input).toStrictEqual(before);
  });
});

describe("groupByEmployeeDay", () => {
  it("lists two shifts of one person on one day under one key, sorted", () => {
    const groups = groupByEmployeeDay([
      assignment(NOON, 0, ANNA),
      assignment(MORNING, 0, ANNA),
      assignment(NIGHT, 0, ANNA),
    ]);

    expect(groups).toStrictEqual({ [employeeDayKey(ANNA, 0)]: [NIGHT, MORNING, NOON] });
  });

  it("gives two people in the same cell a key each", () => {
    const groups = groupByEmployeeDay([assignment(MORNING, 3, BARTEK), assignment(MORNING, 3, ANNA)]);

    expect(groups).toStrictEqual({
      [employeeDayKey(ANNA, 3)]: [MORNING],
      [employeeDayKey(BARTEK, 3)]: [MORNING],
    });
  });

  it("gives the same person on different days a key for each day", () => {
    const groups = groupByEmployeeDay([assignment(MORNING, 1, ANNA), assignment(MORNING, 0, ANNA)]);

    expect(groups).toStrictEqual({
      [employeeDayKey(ANNA, 0)]: [MORNING],
      [employeeDayKey(ANNA, 1)]: [MORNING],
    });
  });

  it("counts a repeated key once", () => {
    const groups = groupByEmployeeDay([
      assignment(MORNING, 0, ANNA),
      assignment(NIGHT, 0, ANNA),
      assignment(MORNING, 0, ANNA),
      assignment(MORNING, 0, ANNA),
    ]);

    expect(groups).toStrictEqual({ [employeeDayKey(ANNA, 0)]: [NIGHT, MORNING] });
  });

  it("gives an empty object for no assignments", () => {
    expect(groupByEmployeeDay([])).toStrictEqual({});
  });

  it("gives every employee and day pair its own key", () => {
    const keys = [ANNA, BARTEK, CEZARY].flatMap((employeeId) =>
      Array.from({ length: PERIOD_DAYS }, (_unused, dayOffset) => employeeDayKey(employeeId, dayOffset)),
    );

    expect(new Set(keys).size).toBe(3 * PERIOD_DAYS);
  });

  it("returns new lists and leaves the input unchanged", () => {
    const input = Object.freeze([assignment(NOON, 0, ANNA), assignment(NIGHT, 0, ANNA), assignment(NIGHT, 1, BARTEK)]);
    const before = structuredClone(input);

    const groups = groupByEmployeeDay(input);

    expect(input).toStrictEqual(before);
    expect(groups[employeeDayKey(ANNA, 0)]).toStrictEqual([NIGHT, NOON]);
    expect(Object.isFrozen(groups[employeeDayKey(ANNA, 0)])).toBe(false);
  });
});

describe("summarizeCoverage", () => {
  // Out of order on purpose (by shift id and day the order is NIGHT/0, MORNING/0, MORNING/1).
  const staffing = [
    { shiftId: MORNING, dayOffset: 1, requiredCount: 3 },
    { shiftId: NIGHT, dayOffset: 0, requiredCount: 1 },
    { shiftId: MORNING, dayOffset: 0, requiredCount: 2 },
  ];

  const cell = (shiftId: string, dayOffset: number, required: number, assigned: number): CoverageCell => ({
    shiftId,
    dayOffset,
    required,
    assigned,
    missing: Math.max(required - assigned, 0),
    surplus: Math.max(assigned - required, 0),
  });

  it("reports everything missing when nobody is assigned", () => {
    expect(summarizeCoverage(staffing, [])).toStrictEqual([
      { shiftId: NIGHT, dayOffset: 0, required: 1, assigned: 0, missing: 1, surplus: 0 },
      { shiftId: MORNING, dayOffset: 0, required: 2, assigned: 0, missing: 2, surplus: 0 },
      { shiftId: MORNING, dayOffset: 1, required: 3, assigned: 0, missing: 3, surplus: 0 },
    ]);
  });

  it("reports zero missing and zero surplus when every cell has exactly the people it needs", () => {
    const assignments = [
      assignment(NIGHT, 0, ANNA),
      assignment(MORNING, 0, ANNA),
      assignment(MORNING, 0, BARTEK),
      assignment(MORNING, 1, ANNA),
      assignment(MORNING, 1, BARTEK),
      assignment(MORNING, 1, CEZARY),
    ];

    expect(summarizeCoverage(staffing, assignments)).toStrictEqual([
      { shiftId: NIGHT, dayOffset: 0, required: 1, assigned: 1, missing: 0, surplus: 0 },
      { shiftId: MORNING, dayOffset: 0, required: 2, assigned: 2, missing: 0, surplus: 0 },
      { shiftId: MORNING, dayOffset: 1, required: 3, assigned: 3, missing: 0, surplus: 0 },
    ]);
  });

  it("reports a surplus of one for three people on a cell that needs two", () => {
    const assignments = [assignment(MORNING, 0, ANNA), assignment(MORNING, 0, BARTEK), assignment(MORNING, 0, CEZARY)];

    expect(summarizeCoverage(staffing, assignments)[1]).toStrictEqual(cell(MORNING, 0, 2, 3));
    expect(summarizeCoverage(staffing, assignments)[1]).toMatchObject({ assigned: 3, missing: 0, surplus: 1 });
  });

  it("reports the shortfall of a cell that is partly covered", () => {
    expect(summarizeCoverage(staffing, [assignment(MORNING, 1, BARTEK)])[2]).toMatchObject({
      required: 3,
      assigned: 1,
      missing: 2,
      surplus: 0,
    });
  });

  it("counts every cell on its own, also for one person on two shifts of one day", () => {
    const assignments = [assignment(NIGHT, 0, ANNA), assignment(MORNING, 0, ANNA)];

    expect(summarizeCoverage(staffing, assignments)).toStrictEqual([
      cell(NIGHT, 0, 1, 1),
      cell(MORNING, 0, 2, 1),
      cell(MORNING, 1, 3, 0),
    ]);
  });

  it("counts a repeated assignment once", () => {
    const assignments = [assignment(NIGHT, 0, ANNA), assignment(NIGHT, 0, ANNA), assignment(NIGHT, 0, ANNA)];

    expect(summarizeCoverage(staffing, assignments)[0]).toStrictEqual(cell(NIGHT, 0, 1, 1));
  });

  it("leaves out an assignment that has no staffing cell", () => {
    const assignments = [
      assignment(NIGHT, 0, ANNA),
      // The same shift on a day without a cell, another shift without any cell, and a cell the grid does not have.
      assignment(NIGHT, 5, ANNA),
      assignment(OTHER_SHIFT, 0, BARTEK),
      assignment(NOON, 1, CEZARY),
    ];

    const result = summarizeCoverage(staffing, assignments);

    expect(result).toStrictEqual([cell(NIGHT, 0, 1, 1), cell(MORNING, 0, 2, 0), cell(MORNING, 1, 3, 0)]);
  });

  it("gives one element per staffing cell, in the order of shift id and day", () => {
    const result = summarizeCoverage(staffing, []);

    expect(result.map((entry) => `${entry.shiftId}/${entry.dayOffset}`)).toStrictEqual([
      `${NIGHT}/0`,
      `${MORNING}/0`,
      `${MORNING}/1`,
    ]);
  });

  it("gives an empty list for an empty grid, whatever the assignments", () => {
    expect(summarizeCoverage([], [assignment(NIGHT, 0, ANNA)])).toStrictEqual([]);
    expect(summarizeCoverage([], [])).toStrictEqual([]);
  });

  it("returns new objects and leaves the input unchanged", () => {
    const grid = Object.freeze(staffing.map((entry) => Object.freeze({ ...entry })));
    const assigned = Object.freeze([assignment(MORNING, 0, BARTEK), assignment(NIGHT, 0, ANNA)]);
    const before = structuredClone({ grid, assigned });

    const result = summarizeCoverage(grid, assigned);

    expect(structuredClone({ grid, assigned })).toStrictEqual(before);
    expect(result).not.toBe(grid);
  });
});

describe("repeatability of the assignment rules", () => {
  const shifts = [NIGHT, MORNING, NOON];
  const people = [ANNA, BARTEK, CEZARY];
  const days = Array.from({ length: PERIOD_DAYS }, (_unused, dayOffset) => dayOffset);

  // Every shift on every day, needing one to three people.
  const grid = shifts.flatMap((shiftId) =>
    days.map((dayOffset) => ({ shiftId, dayOffset, requiredCount: (dayOffset % 3) + 1 })),
  );
  // About half of the person, shift and day combinations, so some cells are short, some full and some over.
  const placed = shifts.flatMap((shiftId, shiftIndex) =>
    people.flatMap((employeeId, personIndex) =>
      days
        .filter((dayOffset) => (shiftIndex + personIndex + dayOffset) % 2 === 0)
        .map((dayOffset) => assignment(shiftId, dayOffset, employeeId)),
    ),
  );
  // Repeats and a shift outside the grid, which must not change the result.
  const roster = [...placed, placed[0], placed[5], assignment(OTHER_SHIFT, 2, ANNA)];
  const seeds = [1, 2, 3, 4, 5, 6];

  it("sorts to the same order for repeated calls and for any input order", () => {
    const sorted = expectDeterministic(sortAssignments, roster, {
      variants: seeds.map((seed) => seededShuffle(roster, seed)),
    });

    expect(sorted).toHaveLength(roster.length);
    expect(keysOf(sorted)).toStrictEqual([...keysOf(sorted)].sort());
  });

  it("groups to the same object, with its keys in the same order, for any input order", () => {
    const groups = expectDeterministic(groupByEmployeeDay, roster, {
      variants: seeds.map((seed) => seededShuffle(roster, seed)),
    });

    const keys = Object.keys(groups);
    expect(keys).toStrictEqual([...keys].sort());
    for (const seed of seeds) {
      expect(Object.keys(groupByEmployeeDay(seededShuffle(roster, seed)))).toStrictEqual(keys);
    }
    for (const shiftIds of Object.values(groups)) {
      expect(shiftIds).toStrictEqual([...new Set(shiftIds)].sort());
    }
  });

  it("summarises to the same coverage for repeated calls and for any order of the grid and the assignments", () => {
    const summarize = (input: { staffing: typeof grid; assignments: typeof roster }) =>
      summarizeCoverage(input.staffing, input.assignments);

    const coverage = expectDeterministic(
      summarize,
      { staffing: grid, assignments: roster },
      {
        variants: seeds.map((seed) => ({
          staffing: seededShuffle(grid, seed),
          assignments: seededShuffle(roster, seed + 100),
        })),
      },
    );

    expect(coverage).toHaveLength(shifts.length * PERIOD_DAYS);
    // The repeats and the shift outside the grid are not counted, so only the placed assignments are.
    expect(coverage.reduce((sum, entry) => sum + entry.assigned, 0)).toBe(placed.length);
    for (const entry of coverage) {
      expect(entry.missing).toBeGreaterThanOrEqual(0);
      expect(entry.surplus).toBeGreaterThanOrEqual(0);
      expect(entry.missing - entry.surplus).toBe(entry.required - entry.assigned);
    }
    // Some cells are short and some over, so the check above is not vacuous.
    expect(coverage.some((entry) => entry.missing > 0)).toBe(true);
    expect(coverage.some((entry) => entry.surplus > 0)).toBe(true);
  });
});
