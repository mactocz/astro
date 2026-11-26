import { useMemo } from "react";
import { evaluateSchedule, summarizeViolations } from "@/lib/services/rules";
import { groupViolationsByEmployee, groupViolationsByEmployeeDay } from "@/lib/services/violation-view";
import type { AssignmentInput, EmployeeOption, Schedule, ShiftOption } from "@/types";

/**
 * The violations of the live check for the current state of the assignment grid, counted again whenever the assignments
 * change. `list` is the optimistic list of `useAssignments` (what the grid shows, a click that is still in flight included),
 * never the assignments the page loaded, so a click that is taken back after a failed save takes its violations back too.
 * `shifts` must be the shifts of the dictionary only: the placeholder the grid shows for a shift that is gone has no hours,
 * and an assignment to a shift that is not in the list is left out by the time rules on purpose.
 *
 * `violations` is in the canonical order of `evaluateSchedule` (critical first). `byEmployeeDay` has the violations
 * anchored to an assignment of a person on a day (key: `employeeDayKey`), `byEmployee` every violation about a person.
 */
export function useViolations({
  schedule,
  shifts,
  employees,
  list,
}: {
  schedule: Pick<Schedule, "startDate" | "staffing">;
  shifts: readonly ShiftOption[];
  employees: readonly EmployeeOption[];
  list: readonly AssignmentInput[];
}) {
  const { startDate, staffing } = schedule;

  return useMemo(() => {
    const violations = evaluateSchedule({ startDate, staffing, assignments: list, shifts, employees });
    return {
      violations,
      counts: summarizeViolations(violations),
      byEmployeeDay: groupViolationsByEmployeeDay(violations),
      byEmployee: groupViolationsByEmployee(violations),
    };
  }, [startDate, staffing, shifts, employees, list]);
}
