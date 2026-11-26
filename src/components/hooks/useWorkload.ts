import { useMemo } from "react";
import { formatWorkload, summarizeWorkload } from "@/lib/services/workload";
import type { AssignmentInput, EmployeeOption, Schedule, ShiftOption } from "@/types";

/** What the "Godziny" column says about one person: "32 h z 40 h" and "mniej o 8 h" (or "równo z normą"). */
export type WorkloadText = ReturnType<typeof formatWorkload>;

/**
 * The hours of each person of the schedule against the weekly norm of their FTE (S-06), counted again whenever the
 * assignments change. `list` is the optimistic list of `useAssignments` (what the grid shows, a click that is still in flight
 * included), never the assignments the page loaded, so a click that is taken back after a failed save takes its hours back too.
 * `shifts` must be the shifts of the dictionary only, as for `useViolations`: the placeholder the grid shows for a shift that
 * is gone has no hours, and an assignment to a shift that is not in the list counts for nothing.
 *
 * The result is keyed by employee id and has an entry for each of the `employees` that is in the roster of the schedule
 * (`schedule.employeeIds`), the one with no shift included ("0 min z 40 h"). It only shows numbers: no threshold and no
 * status, because exceeding the norm is the `weekly_norm` warning of the live rules.
 */
export function useWorkload({
  schedule,
  shifts,
  employees,
  list,
}: {
  schedule: Pick<Schedule, "startDate" | "employeeIds">;
  shifts: readonly ShiftOption[];
  employees: readonly EmployeeOption[];
  list: readonly AssignmentInput[];
}): Partial<Record<string, WorkloadText>> {
  const { startDate, employeeIds } = schedule;

  return useMemo(() => {
    const roster = new Set(employeeIds);
    const rows = summarizeWorkload({
      startDate,
      assignments: list,
      shifts,
      employees: employees.filter((employee) => roster.has(employee.id)),
    });
    return Object.fromEntries(rows.map((row): [string, WorkloadText] => [row.employeeId, formatWorkload(row)]));
  }, [startDate, employeeIds, shifts, employees, list]);
}
