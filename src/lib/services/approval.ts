import { absencesOfRoster } from "@/lib/services/absence";
import { compareViolations } from "@/lib/services/rules";
import type { SafeEvaluation } from "@/lib/services/safe-evaluate";
import { compareCells, compareText } from "@/lib/services/schedule";
import type {
  AbsenceOption,
  ApprovalInputs,
  AssignmentInput,
  EmployeeOption,
  Shift,
  StaffingCell,
  Violation,
  WorkloadRow,
} from "@/types";

// The approval of a schedule (S-08) outside the database: whether the findings allow it, and the data the database is
// given to check and to store. Pure functions; nothing here reads or writes anything.

const approvalDayFormat = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** The day of an approval as the planner's calendar shows it (Polish time), `dd.mm.rrrr`, from an ISO timestamp. */
export function formatApprovalDay(approvedAt: string): string {
  return approvalDayFormat.format(new Date(approvedAt));
}

/** The Polish messages of the refusals, one place for the route and the hooks of the pages. */
export const APPROVAL_MESSAGES = {
  critical_violations: "Nie można zatwierdzić grafiku, w którym są krytyczne naruszenia.",
  confirmation_required: "Lista ostrzeżeń się zmieniła. Sprawdź ją i potwierdź ponownie.",
  schedule_changed: "Dane grafiku zmieniły się w trakcie zatwierdzania. Sprawdź grafik i spróbuj ponownie.",
  schedule_approved: "Ten grafik jest już zatwierdzony i nie można go zmieniać.",
  rules_unavailable: "Nie udało się sprawdzić reguł czasu pracy, więc grafik nie został zatwierdzony.",
} as const;

export type ApprovalDecision =
  | { ok: true; warnings: Violation[] }
  | { ok: false; error: "rules_unavailable" }
  | { ok: false; error: "critical_violations"; critical: Violation[] }
  | { ok: false; error: "confirmation_required"; warnings: Violation[] };

/**
 * Whether a schedule with these findings may be approved, checked in this order: rules that could not be counted refuse it
 * (never an approval without a check), a critical violation refuses it whatever was confirmed, and a warning whose key is
 * not in `confirmedKeys` asks for a confirmation of the current warnings. The confirmed keys may hold more than the current
 * warnings (one that has gone since): the findings counted now are the source of truth. The lists keep the order of the
 * findings.
 */
export function decideApproval(evaluation: SafeEvaluation, confirmedKeys: readonly string[]): ApprovalDecision {
  if (!evaluation.ok) {
    return { ok: false, error: "rules_unavailable" };
  }
  const critical = evaluation.violations.filter((violation) => violation.severity === "critical");
  if (critical.length > 0) {
    return { ok: false, error: "critical_violations", critical };
  }
  const warnings = evaluation.violations.filter((violation) => violation.severity === "warning");
  const confirmed = new Set(confirmedKeys);
  if (warnings.some((warning) => !confirmed.has(warning.key))) {
    return { ok: false, error: "confirmation_required", warnings };
  }
  return { ok: true, warnings };
}

export interface ApprovalPayloadInput {
  schedule: { startDate: string; staffing: readonly StaffingCell[]; employeeIds: readonly string[] };
  /** The shift dictionary; the payload takes the shifts of the staffing cells from it. */
  shifts: readonly Pick<Shift, "id" | "name" | "startMinute" | "endMinute">[];
  /** The people as `toEmployeeOptions` gives them; the payload takes those of the roster. */
  employees: readonly EmployeeOption[];
  assignments: readonly AssignmentInput[];
  /** The absences that touch the schedule, of anybody; the payload takes those of the roster. */
  absences: readonly AbsenceOption[];
  violations: readonly Violation[];
  workload: readonly WorkloadRow[];
}

export interface ApprovalPayload {
  inputs: ApprovalInputs;
  violations: Violation[];
  /** The keys of the warnings of `violations`: what the planner has confirmed once `decideApproval` allows the approval. */
  confirmedKeys: string[];
  workload: Pick<WorkloadRow, "employeeId" | "workedMinutes" | "normMinutes">[];
}

function compareAbsenceOptions(a: AbsenceOption, b: AbsenceOption): number {
  return (
    compareText(a.employeeId, b.employeeId) ||
    compareText(a.startDate, b.startDate) ||
    compareText(a.endDate, b.endDate) ||
    compareText(a.type, b.type) ||
    compareText(a.status, b.status)
  );
}

/**
 * The arguments of `approve_schedule`: the data that was judged, the findings, the confirmed warning keys and the hours of
 * each person. Every list is sorted, so the same data in any order gives the same payload, and only the named fields are
 * copied, so nothing else of an entity (an id of a row, a creation time) goes into it. The input is only read.
 */
export function buildApprovalPayload({
  schedule,
  shifts,
  employees,
  assignments,
  absences,
  violations,
  workload,
}: ApprovalPayloadInput): ApprovalPayload {
  const usedShifts = new Set(schedule.staffing.map((cell) => cell.shiftId));
  const roster = new Set(schedule.employeeIds);
  const sortedViolations = [...violations].sort(compareViolations);
  return {
    inputs: {
      startDate: schedule.startDate,
      staffing: schedule.staffing
        .map(({ shiftId, dayOffset, requiredCount }) => ({ shiftId, dayOffset, requiredCount }))
        .sort(compareCells),
      employeeIds: [...schedule.employeeIds].sort(compareText),
      assignments: assignments
        .map(({ shiftId, dayOffset, employeeId }) => ({ shiftId, dayOffset, employeeId }))
        .sort((a, b) => compareCells(a, b) || compareText(a.employeeId, b.employeeId)),
      shifts: shifts
        .filter((shift) => usedShifts.has(shift.id))
        .map(({ id, name, startMinute, endMinute }) => ({ id, name, startMinute, endMinute }))
        .sort((a, b) => compareText(a.id, b.id)),
      employees: employees
        .filter((employee) => roster.has(employee.id))
        .map(({ id, name, fte }) => ({
          id,
          name,
          fte: { numerator: fte.numerator, denominator: fte.denominator },
        }))
        .sort((a, b) => compareText(a.id, b.id)),
      absences: absencesOfRoster(absences, schedule.employeeIds)
        .map(({ employeeId, type, status, startDate, endDate }) => ({ employeeId, type, status, startDate, endDate }))
        .sort(compareAbsenceOptions),
    },
    violations: sortedViolations,
    confirmedKeys: sortedViolations.filter((violation) => violation.severity === "warning").map(({ key }) => key),
    workload: workload
      .map(({ employeeId, workedMinutes, normMinutes }) => ({ employeeId, workedMinutes, normMinutes }))
      .sort((a, b) => compareText(a.employeeId, b.employeeId)),
  };
}
