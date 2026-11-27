import { excusedWeekdays } from "@/lib/services/absence";
import { holidaysInWeek } from "@/lib/services/calendar";
import { compareText } from "@/lib/services/schedule";
import { formatDuration } from "@/lib/services/shift";
import { normMinutes, weeklyNormExcused, workedMinutesByEmployee, type ShiftTimes } from "@/lib/services/work-hours";
import type { AbsenceOption, AssignmentInput, Fte, WorkloadRow } from "@/types";

// The hours of each person against the weekly norm of their FTE (S-06): a sum, a norm and the difference, in whole minutes,
// and the text to show them. Nothing here judges the numbers (no threshold, no status): exceeding the norm is the
// `weekly_norm` warning of the live rules, which compares with the exact norm. Since S-07 the norm of a person is lowered
// by their approved absences, from the same days (`excusedWeekdays`) and the same holidays as the warning takes them from,
// so that the table and the warning never give two different norms for the same week.

export interface WorkloadInput {
  /** The first day of the schedule as `YYYY-MM-DD`. */
  startDate: string;
  assignments: readonly AssignmentInput[];
  shifts: readonly ShiftTimes[];
  /** The people to give a row to, each id once (the roster of the schedule). */
  employees: readonly { id: string; fte: Fte }[];
  /**
   * The absences of the week, optional: without them the norm is the one of the week alone. Only an approved absence
   * lowers a norm, and only on a day from Monday to Friday that is not a holiday (see `excusedWeekdays`); the absence of a
   * person who is not on the list changes nothing.
   */
  absences?: readonly AbsenceOption[];
}

/**
 * One row per employee of the list, also for one with no shifts (worked 0), sorted by `employeeId` in code-unit order, so
 * the same data in any order gives the same rows. The hours are the full durations of the shifts that start in the
 * schedule (see `workedMinutesByEmployee`); an assignment of a person who is not on the list, or to a shift that is not in
 * `shifts`, is left out. The norm is the weekly norm of the FTE rounded to the minute, lowered by 8 h times the FTE for each
 * day of an approved absence of the person (it can reach 0, and then any work is "więcej o"), and the difference is
 * worked minus that rounded norm: with 3/7 of a week the norm is shown as 17 h 9 min (1029 minutes), so 1029 minutes is
 * "equal" even though it is above the exact norm of 1028.57 minutes that the live rules compare with. Without `absences`
 * the rows are the ones of a week without absences.
 *
 * Throws a RangeError for a `startDate` or an FTE that `weeklyNormExcused` rejects (with at least one employee on the list).
 */
export function summarizeWorkload({
  startDate,
  assignments,
  shifts,
  employees,
  absences = [],
}: WorkloadInput): WorkloadRow[] {
  if (employees.length === 0) {
    return [];
  }
  const worked = new Map(Object.entries(workedMinutesByEmployee(assignments, shifts)));
  const absencesByEmployee = new Map<string, AbsenceOption[]>();
  for (const absence of absences) {
    const own = absencesByEmployee.get(absence.employeeId);
    if (own === undefined) {
      absencesByEmployee.set(absence.employeeId, [absence]);
    } else {
      own.push(absence);
    }
  }
  // The holidays of the week are the same for everybody, so they are looked up once.
  const holidays = holidaysInWeek(startDate);
  return employees
    .map(({ id, fte }): WorkloadRow => {
      const workedMinutes = worked.get(id) ?? 0;
      const own = absencesByEmployee.get(id);
      const excused = own === undefined ? [] : excusedWeekdays(startDate, own, holidays);
      const norm = normMinutes(weeklyNormExcused(holidays, excused, fte));
      return { employeeId: id, workedMinutes, normMinutes: norm, differenceMinutes: workedMinutes - norm };
    })
    .sort((a, b) => compareText(a.employeeId, b.employeeId));
}

/**
 * The text of a row: `total` is "32 h z 40 h" (worked of the norm) and `difference` is "mniej o 8 h", "więcej o 2 h 30 min"
 * or "równo z normą". The hours and minutes are those of `formatDuration`, so a sum of zero reads "0 min". The words carry the
 * direction, so there is no minus sign.
 */
export function formatWorkload(row: WorkloadRow): { total: string; difference: string } {
  const total = `${formatDuration(row.workedMinutes)} z ${formatDuration(row.normMinutes)}`;
  if (row.differenceMinutes === 0) {
    return { total, difference: "równo z normą" };
  }
  const difference =
    row.differenceMinutes < 0
      ? `mniej o ${formatDuration(-row.differenceMinutes)}`
      : `więcej o ${formatDuration(row.differenceMinutes)}`;
  return { total, difference };
}
