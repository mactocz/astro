import { describe, expect, it } from "vitest";
import {
  APPROVAL_MESSAGES,
  buildApprovalPayload,
  decideApproval,
  type ApprovalPayloadInput,
} from "@/lib/services/approval";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import { localDateMethodsCalledBy } from "@/lib/testing/local-time";
import type { Violation, ViolationRule, ViolationSeverity } from "@/types";

const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const JAN = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const OUTSIDER = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const MORNING = "5f1c9a3e-2b7d-4e60-8c14-9a0d3e7b1f25";
const NIGHT = "a3d7e1f4-6c52-4b98-8e0a-1f9c2d5b7a36";
const UNUSED = "c9e2b4a1-7d36-4f85-9b12-6a8e0d4c1f73";

function finding(key: string, severity: ViolationSeverity, rule: ViolationRule): Violation {
  return {
    key,
    severity,
    rule,
    employeeId: null,
    anchors: [],
    reason: `Powód ${key}`,
    actual: 1,
    limit: 2,
    unit: "people",
  };
}

const SHORTAGE_A = finding("understaffed|-|a", "warning", "understaffed");
const SHORTAGE_B = finding("understaffed|-|b", "warning", "understaffed");
const NORM = finding(`weekly_norm|${ANNA}|`, "warning", "weekly_norm");
const REST = finding(`daily_rest|${ANNA}|x`, "critical", "daily_rest");

describe("decideApproval", () => {
  it("allows a schedule without findings", () => {
    expect(decideApproval({ ok: true, violations: [] }, [])).toStrictEqual({ ok: true, warnings: [] });
  });

  it("allows warnings that are all confirmed, also with more keys than there are warnings", () => {
    const evaluation = { ok: true as const, violations: [NORM, SHORTAGE_A] };

    expect(decideApproval(evaluation, [NORM.key, SHORTAGE_A.key])).toStrictEqual({
      ok: true,
      warnings: [NORM, SHORTAGE_A],
    });
    expect(decideApproval(evaluation, [SHORTAGE_B.key, SHORTAGE_A.key, NORM.key])).toStrictEqual({
      ok: true,
      warnings: [NORM, SHORTAGE_A],
    });
  });

  it.each([
    ["none confirmed", []],
    ["one of two confirmed", [SHORTAGE_A.key]],
    ["another key confirmed", [SHORTAGE_B.key, SHORTAGE_A.key]],
  ])("asks for a confirmation of every current warning when there is %s", (_name, confirmedKeys) => {
    expect(decideApproval({ ok: true, violations: [NORM, SHORTAGE_A] }, confirmedKeys)).toStrictEqual({
      ok: false,
      error: "confirmation_required",
      warnings: [NORM, SHORTAGE_A],
    });
  });

  it("refuses a critical violation before it looks at the warnings, whatever is confirmed", () => {
    const evaluation = { ok: true as const, violations: [REST, NORM] };

    for (const confirmedKeys of [[], [REST.key, NORM.key]]) {
      expect(decideApproval(evaluation, confirmedKeys)).toStrictEqual({
        ok: false,
        error: "critical_violations",
        critical: [REST],
      });
    }
  });

  it("refuses rules that could not be counted", () => {
    expect(decideApproval({ ok: false }, [NORM.key])).toStrictEqual({ ok: false, error: "rules_unavailable" });
  });

  it("has a message for every refusal", () => {
    expect(Object.keys(APPROVAL_MESSAGES).sort()).toStrictEqual([
      "confirmation_required",
      "critical_violations",
      "rules_unavailable",
      "schedule_approved",
      "schedule_changed",
    ]);
  });
});

// Anna and Jan are on the schedule; the outsider has an absence and a row in the roster of the dictionary but not here.
const INPUT: ApprovalPayloadInput = {
  schedule: {
    startDate: "2026-11-02",
    staffing: [
      { shiftId: NIGHT, dayOffset: 1, requiredCount: 1 },
      { shiftId: MORNING, dayOffset: 2, requiredCount: 2 },
      { shiftId: MORNING, dayOffset: 0, requiredCount: 1 },
    ],
    employeeIds: [JAN, ANNA],
  },
  shifts: [
    { id: UNUSED, name: "Inna", startMinute: 0, endMinute: 60 },
    { id: NIGHT, name: "Nocna", startMinute: 1320, endMinute: 420 },
    { id: MORNING, name: "Poranna", startMinute: 360, endMinute: 840 },
  ],
  employees: [
    { id: OUTSIDER, name: "Obcy Olaf", fte: { numerator: 1, denominator: 1 } },
    { id: JAN, name: "Nowak Jan", fte: { numerator: 1, denominator: 2 } },
    { id: ANNA, name: "Wiśniewska Anna", fte: { numerator: 1, denominator: 1 } },
  ],
  assignments: [
    { shiftId: NIGHT, dayOffset: 1, employeeId: JAN },
    { shiftId: MORNING, dayOffset: 0, employeeId: JAN },
    { shiftId: MORNING, dayOffset: 0, employeeId: ANNA },
  ],
  absences: [
    { employeeId: JAN, type: "vacation", status: "requested", startDate: "2026-11-06", endDate: "2026-11-06" },
    { employeeId: OUTSIDER, type: "other", status: "approved", startDate: "2026-11-02", endDate: "2026-11-02" },
    { employeeId: ANNA, type: "sick_leave", status: "approved", startDate: "2026-11-05", endDate: "2026-11-06" },
    { employeeId: ANNA, type: "vacation", status: "rejected", startDate: "2026-11-03", endDate: "2026-11-03" },
  ],
  violations: [SHORTAGE_B, NORM, SHORTAGE_A],
  workload: [
    { employeeId: JAN, workedMinutes: 1020, normMinutes: 1200, differenceMinutes: -180 },
    { employeeId: ANNA, workedMinutes: 480, normMinutes: 1440, differenceMinutes: -960 },
  ],
};

describe("buildApprovalPayload", () => {
  it("gives sorted sets with the used shifts and the people of the roster only", () => {
    expect(buildApprovalPayload(INPUT)).toStrictEqual({
      inputs: {
        startDate: "2026-11-02",
        staffing: [
          { shiftId: MORNING, dayOffset: 0, requiredCount: 1 },
          { shiftId: MORNING, dayOffset: 2, requiredCount: 2 },
          { shiftId: NIGHT, dayOffset: 1, requiredCount: 1 },
        ],
        employeeIds: [ANNA, JAN],
        assignments: [
          { shiftId: MORNING, dayOffset: 0, employeeId: ANNA },
          { shiftId: MORNING, dayOffset: 0, employeeId: JAN },
          { shiftId: NIGHT, dayOffset: 1, employeeId: JAN },
        ],
        shifts: [
          { id: MORNING, name: "Poranna", startMinute: 360, endMinute: 840 },
          { id: NIGHT, name: "Nocna", startMinute: 1320, endMinute: 420 },
        ],
        employees: [
          { id: ANNA, name: "Wiśniewska Anna", fte: { numerator: 1, denominator: 1 } },
          { id: JAN, name: "Nowak Jan", fte: { numerator: 1, denominator: 2 } },
        ],
        absences: [
          { employeeId: ANNA, type: "vacation", status: "rejected", startDate: "2026-11-03", endDate: "2026-11-03" },
          { employeeId: ANNA, type: "sick_leave", status: "approved", startDate: "2026-11-05", endDate: "2026-11-06" },
          { employeeId: JAN, type: "vacation", status: "requested", startDate: "2026-11-06", endDate: "2026-11-06" },
        ],
      },
      violations: [NORM, SHORTAGE_A, SHORTAGE_B],
      confirmedKeys: [NORM.key, SHORTAGE_A.key, SHORTAGE_B.key],
      workload: [
        { employeeId: ANNA, workedMinutes: 480, normMinutes: 1440 },
        { employeeId: JAN, workedMinutes: 1020, normMinutes: 1200 },
      ],
    });
  });

  it("confirms the keys of the warnings only", () => {
    const payload = buildApprovalPayload({ ...INPUT, violations: [NORM, REST] });

    expect(payload.violations).toStrictEqual([REST, NORM]);
    expect(payload.confirmedKeys).toStrictEqual([NORM.key]);
  });

  it("does not pass on fields that the payload does not name", () => {
    const payload = buildApprovalPayload({
      ...INPUT,
      assignments: INPUT.assignments.map((assignment) => ({ ...assignment, source: "manual" })),
      employees: INPUT.employees.map((employee) => ({ ...employee, email: "anna@example.com" })),
      absences: INPUT.absences.map((absence) => ({ ...absence, id: "row", createdAt: "2026-01-01T00:00:00Z" })),
    });

    expect(payload).toStrictEqual(buildApprovalPayload(INPUT));
  });

  it("does not depend on the order of the input", () => {
    const variants = [1, 2, 3].map((seed) => ({
      schedule: {
        ...INPUT.schedule,
        staffing: seededShuffle(INPUT.schedule.staffing, seed),
        employeeIds: seededShuffle(INPUT.schedule.employeeIds, seed),
      },
      shifts: seededShuffle(INPUT.shifts, seed),
      employees: seededShuffle(INPUT.employees, seed),
      assignments: seededShuffle(INPUT.assignments, seed),
      absences: seededShuffle(INPUT.absences, seed),
      violations: seededShuffle(INPUT.violations, seed),
      workload: seededShuffle(INPUT.workload, seed),
    }));

    expectDeterministic(buildApprovalPayload, INPUT, { variants });
  });

  it("leaves the input unchanged", () => {
    const input = structuredClone(INPUT);
    Object.freeze(input.schedule.staffing);
    Object.freeze(input.schedule.employeeIds);
    Object.freeze(input.violations);
    Object.freeze(input.assignments);

    buildApprovalPayload(input);

    expect(input).toStrictEqual(INPUT);
  });

  it("reads no local time", () => {
    expect(localDateMethodsCalledBy(() => buildApprovalPayload(INPUT))).toStrictEqual([]);
  });
});
