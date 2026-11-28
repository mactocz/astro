import type { SupabaseClient } from "@supabase/supabase-js";
import { listAbsencesOverlapping } from "@/lib/absences";
import { listAssignments } from "@/lib/assignments";
import { listEmployees } from "@/lib/employees";
import { toAbsenceOptions, toEmployeeOptions } from "@/lib/schedule-options";
import { absencesOfRoster } from "@/lib/services/absence";
import { approvalBasis, sameAssignments } from "@/lib/services/approval";
import { PERIOD_DAYS, addDays } from "@/lib/services/schedule";
import { listShifts } from "@/lib/shifts";
import type { AssignmentInput, Schedule } from "@/types";

// What the routes that act on what the assignment page shows (the approval of S-08, the proposal of S-09) read before
// they do anything, one place so that they cannot drift apart.

/**
 * The data of a draft as the database holds it now, or null when the page that sent `shown` has something else on the
 * screen: another fingerprint (`approvalBasis`) or other assignments. A page opened before a change, or one that lost the
 * answer to a click, is such a page. The reads are those of the assignment page, so what is counted from them is what the
 * planner saw. Throws when a read fails.
 */
export async function readShownSchedule(
  supabase: SupabaseClient,
  schedule: Schedule,
  shown: { basis: string; assignments: readonly AssignmentInput[] },
) {
  const [shifts, allEmployees, assignments, overlapping] = await Promise.all([
    listShifts(supabase),
    listEmployees(supabase),
    listAssignments(supabase, schedule.id),
    listAbsencesOverlapping(supabase, schedule.startDate, addDays(schedule.startDate, PERIOD_DAYS)),
  ]);
  const roster = new Set(schedule.employeeIds);
  const employees = toEmployeeOptions(allEmployees).filter((employee) => roster.has(employee.id));
  const absences = toAbsenceOptions(absencesOfRoster(overlapping, schedule.employeeIds));

  const basis = await approvalBasis({ schedule, shifts, employees, absences });
  if (basis !== shown.basis || !sameAssignments(assignments, shown.assignments)) {
    return null;
  }
  return { shifts, employees, assignments, absences };
}
