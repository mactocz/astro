import { endsNextDay, formatDuration, formatShiftTimes, shiftDurationMinutes } from "@/lib/services/shift";
import type { Absence, AbsenceOption, Employee, EmployeeOption, Shift, ShiftOption } from "@/types";

// What the schedule islands receive: plain data with the times already formatted and the minutes the work-time rules
// count with, and for the people the name and the FTE (which those rules need), so that an e-mail address never travels
// into the page just to fill a list of check boxes. The order of the input is kept; the pages pass lists that
// `listShifts` and `listEmployees` have already sorted. The absences the assignment island gets are the same kind of plain
// data: the person, the type, the status and the two days, never the id of the row or its creation time (an L4 is health data,
// and what is not needed does not go into a page that every planner's browser keeps).

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

export function toAbsenceOptions(absences: readonly Absence[]): AbsenceOption[] {
  return absences.map((absence) => ({
    employeeId: absence.employeeId,
    type: absence.type,
    status: absence.status,
    startDate: absence.startDate,
    endDate: absence.endDate,
  }));
}

/**
 * The placeholder for a shift that a schedule still refers to but the dictionary no longer lists: it keeps its row or its
 * buttons on the page, so that nothing in the schedule is hidden. For display only. It has no hours: `times` and `duration`
 * are empty and both minutes are 0, which is a zero-length shift that `validateShiftInput` and the database refuse. It must
 * never be passed to the work-time rules, which take the shifts of the dictionary only (an assignment to a shift that is
 * not on their list is left out of the time rules on purpose); with it in the list, a 00:00-00:00 segment would give false
 * violations.
 */
export function unavailableShift(id: string): ShiftOption {
  return { id, name: "(niedostępne)", times: "", endsNextDay: false, duration: "", startMinute: 0, endMinute: 0 };
}
