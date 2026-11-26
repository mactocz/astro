import { describe, expect, it } from "vitest";
import { evaluateSchedule, type RuleInput } from "@/lib/services/rules";
import { safeEvaluate } from "@/lib/services/safe-evaluate";
import { expectDeterministic } from "@/lib/testing/determinism";

const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const LONG = "a3d7e1f4-6c52-4b98-8e0a-1f9c2d5b7a36";
const MORNING = "5f1c9a3e-2b7d-4e60-8c14-9a0d3e7b1f25";

// Monday 2 November 2026. Anna works the 9 h shift on day 0 (a critical violation of the hours in a day) and the morning
// shift needs two people on day 1 and nobody is on it (a warning), so a valid input has violations of both weights.
const VALID: RuleInput = {
  startDate: "2026-11-02",
  staffing: [
    { shiftId: LONG, dayOffset: 0, requiredCount: 1 },
    { shiftId: MORNING, dayOffset: 1, requiredCount: 2 },
  ],
  assignments: [{ shiftId: LONG, dayOffset: 0, employeeId: ANNA }],
  shifts: [
    { id: LONG, name: "Długa", startMinute: 360, endMinute: 900 },
    { id: MORNING, name: "Poranna", startMinute: 360, endMinute: 840 },
  ],
  employees: [{ id: ANNA, name: "Wiśniewska Anna", fte: { numerator: 1, denominator: 1 } }],
};

describe("safeEvaluate", () => {
  it("gives the violations of evaluateSchedule for a valid input", () => {
    const result = safeEvaluate(VALID);

    expect(result).toStrictEqual({ ok: true, violations: evaluateSchedule(VALID) });
    // Not an empty comparison: the input does have violations of both weights.
    expect(result.ok && result.violations.map(({ severity }) => severity)).toStrictEqual(["critical", "warning"]);
  });

  it("gives an empty list, still ok, for a valid input that has no violations", () => {
    const quiet: RuleInput = { ...VALID, staffing: [], assignments: [] };

    expect(safeEvaluate(quiet)).toStrictEqual({ ok: true, violations: [] });
  });

  it.each(["2026-13-40", "2019-12-30", "2100-01-01", "not a date", ""])(
    "gives { ok: false } and does not throw for the start date %j",
    (startDate) => {
      expect(() => evaluateSchedule({ ...VALID, startDate })).toThrow(RangeError);

      expect(() => safeEvaluate({ ...VALID, startDate })).not.toThrow();
      expect(safeEvaluate({ ...VALID, startDate })).toStrictEqual({ ok: false });
    },
  );

  it.each([
    { numerator: 0, denominator: 1 },
    { numerator: 3, denominator: 2 },
    { numerator: 1.5, denominator: 2 },
    { numerator: 1, denominator: Number.NaN },
  ])("gives { ok: false } and does not throw for the FTE %j of a person who works", (fte) => {
    const input: RuleInput = { ...VALID, employees: [{ id: ANNA, name: "Wiśniewska Anna", fte }] };

    expect(() => evaluateSchedule(input)).toThrow(RangeError);

    expect(() => safeEvaluate(input)).not.toThrow();
    expect(safeEvaluate(input)).toStrictEqual({ ok: false });
  });

  it("gives { ok: false }, not an empty list, so that a failure never reads as no violations", () => {
    const result = safeEvaluate({ ...VALID, startDate: "2026-13-40" });

    expect(result).not.toHaveProperty("violations");
    expect(result.ok).toBe(false);
  });

  it("gives the same answer for the same input, a failure included", () => {
    expectDeterministic(safeEvaluate, VALID);
    expectDeterministic(safeEvaluate, { ...VALID, startDate: "2026-13-40" });
  });

  it("leaves the input unchanged", () => {
    const before = structuredClone(VALID);

    safeEvaluate(VALID);
    safeEvaluate({ ...VALID, startDate: "2026-13-40" });

    expect(VALID).toStrictEqual(before);
  });
});
