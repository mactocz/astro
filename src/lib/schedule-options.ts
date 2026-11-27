import { endsNextDay, formatDuration, formatShiftTimes, shiftDurationMinutes, sortShifts } from "@/lib/services/shift";
import { formatWorkload } from "@/lib/services/workload";
import type {
  Absence,
  AbsenceOption,
  ApprovalSnapshotEmployee,
  ApprovalSnapshotShift,
  Employee,
  EmployeeOption,
  Shift,
  ShiftOption,
} from "@/types";

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

// An approved schedule is shown from the copy made at the approval, never from the live dictionary and roster, so a later
// edit of a shift or of a person does not change what the page says. The three functions below give that copy the shapes
// the island already takes.

/** The shifts of an approval as options, in the order of the shift list. */
export function snapshotShiftOptions(shifts: readonly ApprovalSnapshotShift[]): ShiftOption[] {
  // The copy has no creation time; one fixed value for all leaves the last tie of the order to the id.
  const createdAt = "1970-01-01T00:00:00.000Z";
  return toShiftOptions(
    sortShifts(
      shifts.map(({ shiftId, name, startMinute, endMinute }) => ({
        id: shiftId,
        name,
        startMinute,
        endMinute,
        createdAt,
      })),
    ),
  );
}

const nameCollator = new Intl.Collator("pl");

/** The people of an approval as options, by name (Polish collation) and then by id. */
export function snapshotEmployeeOptions(employees: readonly ApprovalSnapshotEmployee[]): EmployeeOption[] {
  return employees
    .map((employee) => ({
      id: employee.employeeId,
      name: employee.displayName,
      fte: { numerator: employee.fte.numerator, denominator: employee.fte.denominator },
    }))
    .sort((a, b) => nameCollator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The texts of the column "Godziny" from the hours stored at the approval, by employee id. */
export function snapshotHours(
  employees: readonly ApprovalSnapshotEmployee[],
): Record<string, ReturnType<typeof formatWorkload>> {
  return Object.fromEntries(
    employees.map(({ employeeId, workedMinutes, normMinutes }) => [
      employeeId,
      formatWorkload({ employeeId, workedMinutes, normMinutes, differenceMinutes: workedMinutes - normMinutes }),
    ]),
  );
}
