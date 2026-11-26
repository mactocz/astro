import { endsNextDay, formatDuration, formatShiftTimes, shiftDurationMinutes } from "@/lib/services/shift";
import type { Employee, EmployeeOption, Shift, ShiftOption } from "@/types";

// What the schedule islands receive: plain data with the times already formatted and the minutes the work-time rules
// count with, and for the people the name and the FTE (which those rules need), so that an e-mail address never travels
// into the page just to fill a list of check boxes. The order of the input is kept; the pages pass lists that
// `listShifts` and `listEmployees` have already sorted.

export function toShiftOptions(shifts: readonly Shift[]): ShiftOption[] {
  return shifts.map((shift) => ({
    id: shift.id,
    name: shift.name,
    times: formatShiftTimes(shift),
    endsNextDay: endsNextDay(shift),
    duration: formatDuration(shiftDurationMinutes(shift)),
    startMinute: shift.startMinute,
    endMinute: shift.endMinute,
  }));
}

export function toEmployeeOptions(employees: readonly Employee[]): EmployeeOption[] {
  return employees.map((employee) => ({
    id: employee.id,
    name: `${employee.lastName} ${employee.firstName}`,
    fte: { numerator: employee.fte.numerator, denominator: employee.fte.denominator },
  }));
}
