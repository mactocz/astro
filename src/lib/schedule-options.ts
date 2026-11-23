import { endsNextDay, formatDuration, formatShiftTimes, shiftDurationMinutes } from "@/lib/services/shift";
import type { Employee, EmployeeOption, Shift, ShiftOption } from "@/types";

// What the schedule form island receives: plain data with the times already formatted, and for the people only the
// name, so that an e-mail address or an FTE never travels into the page just to fill a list of check boxes. The order
// of the input is kept; the pages pass lists that `listShifts` and `listEmployees` have already sorted.

export function toShiftOptions(shifts: readonly Shift[]): ShiftOption[] {
  return shifts.map((shift) => ({
    id: shift.id,
    name: shift.name,
    times: formatShiftTimes(shift),
    endsNextDay: endsNextDay(shift),
    duration: formatDuration(shiftDurationMinutes(shift)),
  }));
}

export function toEmployeeOptions(employees: readonly Employee[]): EmployeeOption[] {
  return employees.map((employee) => ({ id: employee.id, name: `${employee.lastName} ${employee.firstName}` }));
}
