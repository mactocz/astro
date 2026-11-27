import { useMemo } from "react";
import { summarizeViolations } from "@/lib/services/rules";
import { safeEvaluate } from "@/lib/services/safe-evaluate";
import { groupViolationsByEmployee, groupViolationsByEmployeeDay } from "@/lib/services/violation-view";
import type { AbsenceOption, AssignmentInput, EmployeeOption, Schedule, ShiftOption } from "@/types";

/**
 * The violations of the live check for the current state of the assignment grid, counted again whenever the assignments
 * change. `list` is the optimistic list of `useAssignments` (what the grid shows, a click that is still in flight included),
 * never the assignments the page loaded, so a click that is taken back after a failed save takes its violations back too.
 * `shifts` must be the shifts of the dictionary only: the placeholder the grid shows for a shift that is gone
 * (`unavailableShift`) has no hours, and an assignment to a shift that is not in the list is left out by the time rules on
 * purpose. `absences` are the absences of the people of the schedule that touch it (S-07): an assignment on a day of an approved
 * one is critical, on a day of a requested one a warning, and an approved one lowers the weekly norm of its person. They come
 * from the page and do not change while the island is open, so they only join the list of what the memo depends on.
 *
 * `violations` is in the canonical order of `evaluateSchedule` (critical first). `byEmployeeDay` has the violations
 * anchored to an assignment of a person on a day (key: `employeeDayKey`), `byEmployee` every violation about a person.
 *
 * `failed` is true when the rules threw (a start date or an FTE they reject, which the constraints of the database keep out
 * today): then `violations` is empty, `counts` are zero and both maps are empty, and the view must say that nothing was
 * checked rather than show "no violations".
 */
export function useViolations({
  schedule,
  shifts,
  employees,
  list,
  absences,
}: {
  schedule: Pick<Schedule, "startDate" | "staffing">;
  shifts: readonly ShiftOption[];
  employees: readonly EmployeeOption[];
  list: readonly AssignmentInput[];
  absences: readonly AbsenceOption[];
}) {
  const { startDate, staffing } = schedule;

  return useMemo(() => {
    const result = safeEvaluate({ startDate, staffing, assignments: list, shifts, employees, absences });
    const violations = result.ok ? result.violations : [];
    return {
      violations,
      counts: summarizeViolations(violations),
      byEmployeeDay: groupViolationsByEmployeeDay(violations),
      byEmployee: groupViolationsByEmployee(violations),
      failed: !result.ok,
    };
  }, [startDate, staffing, shifts, employees, list, absences]);
}
