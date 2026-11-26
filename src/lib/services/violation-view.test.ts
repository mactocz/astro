import { describe, expect, it } from "vitest";
import { employeeDayKey } from "@/lib/services/assignment";
import {
  NO_VIOLATIONS_TEXT,
  formatCellMarker,
  formatViolationCounter,
  formatViolationCounts,
  groupViolationsByEmployee,
  groupViolationsByEmployeeDay,
  pluralPl,
} from "@/lib/services/violation-view";
import { expectDeterministic } from "@/lib/testing/determinism";
import type { Violation, ViolationAnchor } from "@/types";

const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";
const MORNING = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";
const NIGHT = "7a9c1e3b-5d2f-4b8a-9c6e-0f1d2a3b4c5d";

const anchor = (employeeId: string | null, dayOffset: number, shiftId = MORNING): ViolationAnchor => ({
  shiftId,
  dayOffset,
  employeeId,
});

// Only what the grouping reads is meaningful: the key, the employee and the anchors.
function violation(
  key: string,
  severity: Violation["severity"],
  employeeId: string | null,
  anchors: ViolationAnchor[],
): Violation {
  return {
    key,
    severity,
    rule: severity === "critical" ? "daily_rest" : "understaffed",
    employeeId,
    anchors,
    reason: key,
    actual: 0,
    limit: 0,
    unit: "minutes",
  };
}

describe("pluralPl", () => {
  it.each<[number, "one" | "few" | "many"]>([
    [0, "many"],
    [1, "one"],
    [2, "few"],
    [3, "few"],
    [4, "few"],
    [5, "many"],
    [9, "many"],
    [10, "many"],
    [11, "many"],
    [12, "many"],
    [13, "many"],
    [14, "many"],
    [15, "many"],
    [20, "many"],
    [21, "many"],
    [22, "few"],
    [24, "few"],
    [25, "many"],
    [100, "many"],
    [101, "many"],
    [102, "few"],
    [111, "many"],
    [112, "many"],
    [114, "many"],
    [122, "few"],
  ])("picks the form for %i", (count, form) => {
    expect(pluralPl(count, "one", "few", "many")).toBe(form);
  });
});

describe("formatViolationCounts", () => {
  it.each<[number, number, string]>([
    [0, 0, ""],
    [1, 0, "1 krytyczne"],
    [2, 0, "2 krytyczne"],
    [4, 0, "4 krytyczne"],
    [5, 0, "5 krytycznych"],
    [12, 0, "12 krytycznych"],
    [22, 0, "22 krytyczne"],
    [0, 1, "1 ostrzeżenie"],
    [0, 2, "2 ostrzeżenia"],
    [0, 4, "4 ostrzeżenia"],
    [0, 5, "5 ostrzeżeń"],
    [0, 13, "13 ostrzeżeń"],
    [0, 23, "23 ostrzeżenia"],
    [1, 2, "1 krytyczne, 2 ostrzeżenia"],
    [2, 1, "2 krytyczne, 1 ostrzeżenie"],
    [5, 12, "5 krytycznych, 12 ostrzeżeń"],
  ])("writes %i critical and %i warnings as %j", (critical, warning, text) => {
    expect(formatViolationCounts({ critical, warning })).toBe(text);
  });
});

describe("formatViolationCounter", () => {
  it("says there is nothing to report when both counts are zero", () => {
    expect(formatViolationCounter({ critical: 0, warning: 0 })).toBe(NO_VIOLATIONS_TEXT);
    expect(NO_VIOLATIONS_TEXT).toBe("Brak wskazań");
  });

  it.each<[number, number, string]>([
    [1, 2, "Wskazania: 1 krytyczne, 2 ostrzeżenia"],
    [0, 3, "Wskazania: 3 ostrzeżenia"],
    [6, 0, "Wskazania: 6 krytycznych"],
  ])("writes %i critical and %i warnings as %j", (critical, warning, text) => {
    expect(formatViolationCounter({ critical, warning })).toBe(text);
  });
});

describe("formatCellMarker", () => {
  it.each<[number, number, string]>([
    [0, 0, ""],
    [2, 0, "Krytyczne: 2"],
    [0, 1, "Ostrzeżenie: 1"],
    [1, 3, "Krytyczne: 1, Ostrzeżenie: 3"],
  ])("writes %i critical and %i warnings as %j", (critical, warning, text) => {
    expect(formatCellMarker({ critical, warning })).toBe(text);
  });
});

describe("groupViolationsByEmployeeDay", () => {
  const restAcrossTwoDays = violation("rest", "critical", ANNA, [anchor(ANNA, 1), anchor(ANNA, 2)]);
  const hoursInOneCell = violation("hours", "critical", ANNA, [anchor(ANNA, 2, MORNING), anchor(ANNA, 2, NIGHT)]);
  const weekOfAnna = violation("week", "critical", ANNA, []);
  const shortage = violation("shortage", "warning", null, [anchor(null, 2)]);
  const restOfBartek = violation("rest-bartek", "critical", BARTEK, [anchor(BARTEK, 2), anchor(BARTEK, 3)]);
  const all = [restAcrossTwoDays, hoursInOneCell, weekOfAnna, shortage, restOfBartek];

  it("puts a violation in the cell of each of its anchors, once for each cell, in the order it got", () => {
    expect(groupViolationsByEmployeeDay(all)).toStrictEqual({
      [employeeDayKey(ANNA, 1)]: [restAcrossTwoDays],
      [employeeDayKey(ANNA, 2)]: [restAcrossTwoDays, hoursInOneCell],
      [employeeDayKey(BARTEK, 2)]: [restOfBartek],
      [employeeDayKey(BARTEK, 3)]: [restOfBartek],
    });
  });

  it("gives no cell to a violation of a whole week or to a shortage of staff", () => {
    expect(groupViolationsByEmployeeDay([weekOfAnna, shortage])).toStrictEqual({});
    expect(groupViolationsByEmployeeDay([])).toStrictEqual({});
  });

  it("leaves the input as it was and gives the same result every time", () => {
    const input = Object.freeze(structuredClone(all));
    const before = structuredClone(input);

    expectDeterministic(groupViolationsByEmployeeDay, input);
    expect(input).toStrictEqual(before);
  });
});

describe("groupViolationsByEmployee", () => {
  const restOfAnna = violation("rest", "critical", ANNA, [anchor(ANNA, 1), anchor(ANNA, 2)]);
  const weekOfAnna = violation("week", "critical", ANNA, []);
  const normOfBartek = violation("norm", "warning", BARTEK, []);
  const shortage = violation("shortage", "warning", null, [anchor(null, 2)]);

  it("lists every violation about a person, whole weeks and cells alike, in the order it got", () => {
    expect(groupViolationsByEmployee([restOfAnna, shortage, weekOfAnna, normOfBartek])).toStrictEqual({
      [ANNA]: [restOfAnna, weekOfAnna],
      [BARTEK]: [normOfBartek],
    });
  });

  it("gives no entry to a shortage of staff, which is about no person", () => {
    expect(groupViolationsByEmployee([shortage])).toStrictEqual({});
  });

  it("leaves the input as it was and gives the same result every time", () => {
    const input = Object.freeze([restOfAnna, shortage, weekOfAnna, normOfBartek]);
    const before = structuredClone(input);

    expectDeterministic(groupViolationsByEmployee, input);
    expect(input).toStrictEqual(before);
  });
});
