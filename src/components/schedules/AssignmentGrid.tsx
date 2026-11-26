import { Check, OctagonAlert, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { ServerError } from "@/components/auth/ServerError";
import { assignmentKey, useAssignments } from "@/components/hooks/useAssignments";
import { useViolations } from "@/components/hooks/useViolations";
import { useWorkload, type WorkloadText } from "@/components/hooks/useWorkload";
import { ViolationList } from "@/components/schedules/ViolationList";
import { employeeDayKey } from "@/lib/services/assignment";
import { summarizeViolations } from "@/lib/services/rules";
import { PERIOD_DAYS, dayColumns } from "@/lib/services/schedule";
import { formatCellMarker, formatViolationCounts } from "@/lib/services/violation-view";
import { cn } from "@/lib/utils";
import type {
  AssignmentInput,
  CoverageCell,
  EmployeeOption,
  Schedule,
  ShiftOption,
  StaffingCell,
  Violation,
} from "@/types";

interface Props {
  schedule: Schedule;
  /** Every shift of the dictionary, in the order to show them. */
  shifts: ShiftOption[];
  /** Every employee, in the order to list them; the grid shows the ones that are in the schedule. */
  employees: EmployeeOption[];
  /** What the page loaded: the assignments of the schedule. */
  assignments: AssignmentInput[];
}

// The first column stays in place while the days scroll. Its background is opaque (the card behind it is not), or the
// scrolled cells would show through. A copy of `stickyCell` in StaffingGrid.tsx: the two grids are the only users, so it is
// repeated here on purpose rather than lifted into a shared module.
const stickyCell = "sticky left-0 z-10 min-w-44 max-w-56 border-r border-white/10 bg-slate-800";
const shiftButtonClass =
  "flex min-h-8 w-full items-start gap-1 rounded-md border px-1.5 py-1 text-left text-xs leading-snug transition-colors focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:outline-none";
// A pressed button differs from the others by fill, border, weight and a tick, not only by colour.
const shiftButtonPressedClass = "border-purple-200 bg-purple-600 font-semibold text-white hover:bg-purple-500";
const shiftButtonIdleClass = "border-white/20 bg-white/5 text-blue-100/80 hover:bg-white/15 hover:text-white";

// What the paragraph under the people's table says about the column "Godziny", always. The same words are in the smoke test.
const HOURS_NOTE =
  "Godziny: suma zmian rozpoczętych w tym grafiku względem normy tygodniowej etatu (40 h pomniejszone o 8 h za każde święto w dzień inny niż niedziela, proporcjonalnie do etatu). Nieobecności nie są jeszcze uwzględnione. Przekroczenie normy pokazuje lista wskazań.";

const cellKey = (shiftId: string, dayOffset: number): string => `${shiftId}/${dayOffset}`;

// A shift that has staffing in the schedule but is no longer on the list: it keeps its buttons, so nobody is hidden.
function unavailableShift(id: string): ShiftOption {
  return { id, name: "(niedostępne)", times: "", endsNextDay: false, duration: "", startMinute: 0, endMinute: 0 };
}

// The name and the hours, which tell apart two shifts that share a name. A shift that is gone has no hours to show.
function shiftTitle(shift: ShiftOption): string {
  return shift.times ? `${shift.name} ${shift.times}` : shift.name;
}

// The shifts that have staffing on at least one day, in the order of the shift list (a shift that is gone last), and for
// each day the ones among them that have staffing that day. Only those get a button, so nobody can be put on a shift that
// does not run on that day.
function shiftLayout(shifts: readonly ShiftOption[], staffing: readonly StaffingCell[]) {
  const staffedIds = new Set(staffing.map((cell) => cell.shiftId));
  const offered = new Set(shifts.map((shift) => shift.id));
  const rows = [
    ...shifts.filter((shift) => staffedIds.has(shift.id)),
    ...[...staffedIds].filter((id) => !offered.has(id)).map(unavailableShift),
  ];
  const staffedCells = new Set(staffing.map((cell) => cellKey(cell.shiftId, cell.dayOffset)));
  const byDay = Array.from({ length: PERIOD_DAYS }, (_unused, dayOffset) =>
    rows.filter((shift) => staffedCells.has(cellKey(shift.id, dayOffset))),
  );
  return { rows, byDay };
}

// A day without the thing the cell is about: a dash for the eye, and the words for a screen reader.
function Dash({ description }: { description: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-blue-100/40">
        —
      </span>
      <span className="sr-only">{description}</span>
    </>
  );
}

// "1 z 2", and what is missing (−n) or in excess (+n) as text, so the colour is only an addition to it. Neither is an
// error: it is information about the coverage.
function CoverageValue({ cell }: { cell: CoverageCell }) {
  return (
    <>
      <span className="whitespace-nowrap text-white">{`${cell.assigned} z ${cell.required}`}</span>
      {cell.missing > 0 ? (
        <span className="ml-1 font-medium whitespace-nowrap text-amber-200">
          <span aria-hidden="true">{`−${cell.missing}`}</span>
          <span className="sr-only">{`brakuje ${cell.missing}`}</span>
        </span>
      ) : null}
      {cell.surplus > 0 ? (
        <span className="ml-1 font-medium whitespace-nowrap text-sky-200">
          <span aria-hidden="true">{`+${cell.surplus}`}</span>
          <span className="sr-only">{`nadmiar ${cell.surplus}`}</span>
        </span>
      ) : null}
    </>
  );
}

// What a cell says under its buttons when a violation sits on it: the weight in words with the count ("Krytyczne: 2"), the
// icon and the colour only an addition. The whole text is one string, so the markup never splits it.
function CellMarker({ violations }: { violations: readonly Violation[] }) {
  const counts = summarizeViolations(violations);
  const Icon = counts.critical > 0 ? OctagonAlert : TriangleAlert;
  return (
    <div
      className={cn(
        "mt-1 flex items-start justify-center gap-1 text-xs leading-snug font-medium",
        counts.critical > 0 ? "text-red-200" : "text-amber-200",
      )}
    >
      <Icon aria-hidden="true" className="mt-px size-3 shrink-0" />
      <span>{formatCellMarker(counts)}</span>
    </div>
  );
}

// What the "Wskazania" column says about a person: all their violations in words ("2 krytyczne, 1 ostrzeżenie"), or "brak".
function PersonViolations({ violations }: { violations: readonly Violation[] | undefined }) {
  const counts = summarizeViolations(violations ?? []);
  const text = formatViolationCounts(counts);
  if (text === "") {
    return <span className="text-blue-100/40">brak</span>;
  }
  return <span className={cn("font-medium", counts.critical > 0 ? "text-red-200" : "text-amber-200")}>{text}</span>;
}

// What the "Godziny" column says about a person: the hours of the schedule against the norm ("32 h z 40 h") and the difference
// in words ("mniej o 8 h"), each on a line of its own. The colour is the one of the grid text, never a status: the column only
// shows numbers, and exceeding the norm is a warning of the list. One explicit space between the two lines, so the text of the
// cell reads "32 h z 40 h mniej o 8 h" without its tags.
function PersonHours({ hours }: { hours: WorkloadText | undefined }) {
  if (hours === undefined) {
    return null;
  }
  return (
    <>
      <div className="font-medium whitespace-nowrap text-white">{hours.total}</div>{" "}
      <div className="whitespace-nowrap text-blue-100/70">{hours.difference}</div>
    </>
  );
}

export default function AssignmentGrid({ schedule, shifts, employees, assignments }: Props) {
  const { list, byEmployeeDay, coverage, busy, error, toggle } = useAssignments({
    scheduleId: schedule.id,
    staffing: schedule.staffing,
    initial: assignments,
  });
  // The rules read the optimistic list of the hook, so they follow every click, a click that is taken back included. They get
  // the shifts of the dictionary only, never the placeholder of `shiftLayout`, which has no hours.
  const violations = useViolations({ schedule, shifts, employees, list });
  // The hours follow every click the same way, from the same list and the same dictionary shifts.
  const workload = useWorkload({ schedule, shifts, employees, list });

  const columns = useMemo(() => dayColumns(schedule.startDate), [schedule.startDate]);
  // The rows are the people of the schedule, in the order of the employee list.
  const members = useMemo(() => {
    const inSchedule = new Set(schedule.employeeIds);
    return employees.filter((employee) => inSchedule.has(employee.id));
  }, [employees, schedule.employeeIds]);
  const layout = useMemo(() => shiftLayout(shifts, schedule.staffing), [shifts, schedule.staffing]);
  const coverageByCell = useMemo(
    () => new Map(coverage.map((cell) => [cellKey(cell.shiftId, cell.dayOffset), cell])),
    [coverage],
  );

  return (
    <div>
      <p className="mb-2 text-xs text-blue-100/50">
        Kliknij zmianę, żeby przypisać do niej pracownika w danym dniu. Kliknij ją ponownie, żeby zdjąć przypisanie.
        Każda zmiana zapisuje się od razu.
      </p>

      <ServerError message={error} />

      {/* `relative`: the visually hidden texts (`sr-only`) are positioned absolutely, and without a positioned scroll container
          they escape its clipping and widen the whole page on a narrow screen. */}
      <div className="relative mt-2 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[68rem] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">Przypisania pracowników do zmian w kolejnych dniach grafiku</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(stickyCell, "px-3 py-2 text-left font-medium text-blue-100/60")}>
                Pracownik
              </th>
              {columns.map((column) => (
                <th
                  key={column.offset}
                  scope="col"
                  className="px-1 py-2 text-center font-medium whitespace-nowrap text-blue-100/60"
                >
                  {column.label}
                </th>
              ))}
              <th scope="col" className="min-w-32 px-2 py-2 text-left font-medium whitespace-nowrap text-blue-100/60">
                Wskazania
              </th>
              <th scope="col" className="min-w-36 px-2 py-2 text-left font-medium whitespace-nowrap text-blue-100/60">
                Godziny
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((employee) => (
              <tr key={employee.id}>
                <th scope="row" className={cn(stickyCell, "border-t px-3 py-2 text-left font-normal")}>
                  <span className="block font-semibold break-words text-white">{employee.name}</span>
                </th>
                {columns.map((column) => {
                  const dayShifts = layout.byDay[column.offset];
                  const dayKey = employeeDayKey(employee.id, column.offset);
                  const pressedShiftIds = byEmployeeDay[dayKey];
                  const cellViolations = violations.byEmployeeDay[dayKey];
                  return (
                    <td key={column.offset} className="border-t border-white/10 px-1 py-2 text-center align-top">
                      {dayShifts.length === 0 ? (
                        <Dash description="brak zmian tego dnia" />
                      ) : (
                        <div className="flex flex-col gap-1">
                          {dayShifts.map((shift) => {
                            const pressed = pressedShiftIds?.includes(shift.id) ?? false;
                            const inFlight = busy.has(assignmentKey(employee.id, column.offset, shift.id));
                            return (
                              <button
                                key={shift.id}
                                type="button"
                                aria-pressed={pressed}
                                aria-label={`${employee.name}, ${column.label}, ${shiftTitle(shift)}`}
                                // Not `disabled` while the request is in flight: the button would drop the keyboard focus. A
                                // click in the meantime is ignored by the hook.
                                aria-busy={inFlight ? true : undefined}
                                onClick={() => {
                                  void toggle(employee.id, column.offset, shift.id);
                                }}
                                className={cn(
                                  shiftButtonClass,
                                  pressed ? shiftButtonPressedClass : shiftButtonIdleClass,
                                  inFlight && "cursor-progress opacity-70",
                                )}
                              >
                                <span aria-hidden="true" className="mt-px size-3 shrink-0">
                                  {pressed ? <Check className="size-3" /> : null}
                                </span>
                                <span className="min-w-0 break-words">{shiftTitle(shift)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {cellViolations ? <CellMarker violations={cellViolations} /> : null}
                    </td>
                  );
                })}
                <td className="min-w-32 border-t border-white/10 px-2 py-2 text-left align-top text-xs">
                  <PersonViolations violations={violations.byEmployee[employee.id]} />
                </td>
                <td className="min-w-36 border-t border-white/10 px-2 py-2 text-left align-top text-xs">
                  <PersonHours hours={workload[employee.id]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-blue-100/50">{HOURS_NOTE}</p>

      <ViolationList violations={violations.violations} counts={violations.counts} />

      <section aria-labelledby="coverage-heading" className="mt-6">
        <h2 id="coverage-heading" className="mb-1 text-lg font-semibold text-white">
          Obsada zmian
        </h2>
        <p className="mb-2 text-xs text-blue-100/50">
          Ile osób jest przypisanych z ilu potrzebnych. Oznaczenie −n to brak osób, a +n to nadmiar. Brak obsady jest
          ostrzeżeniem na liście wskazań, a nadmiar tylko informacją.
        </p>
        <div className="relative overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Liczba przypisanych osób do liczby potrzebnych, według zmiany i dnia</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(stickyCell, "px-3 py-2 text-left font-medium text-blue-100/60")}>
                  Zmiana
                </th>
                {columns.map((column) => (
                  <th
                    key={column.offset}
                    scope="col"
                    className="px-1 py-2 text-center font-medium whitespace-nowrap text-blue-100/60"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {layout.rows.map((shift) => (
                <tr key={shift.id}>
                  <th scope="row" className={cn(stickyCell, "border-t px-3 py-2 text-left font-normal")}>
                    <span className="block font-semibold break-words text-white">{shift.name}</span>
                    {shift.times ? (
                      <span className="block text-xs text-blue-100/60">
                        {shift.times}
                        {shift.endsNextDay ? ", następnego dnia" : ""}, {shift.duration}
                      </span>
                    ) : null}
                  </th>
                  {columns.map((column) => {
                    const cell = coverageByCell.get(cellKey(shift.id, column.offset));
                    return (
                      <td key={column.offset} className="border-t border-white/10 px-1 py-2 text-center">
                        {cell ? <CoverageValue cell={cell} /> : <Dash description="brak tej zmiany tego dnia" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
