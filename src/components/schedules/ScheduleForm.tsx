import { CalendarDays, CircleAlert, Tag, TriangleAlert } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { useScheduleForm } from "@/components/hooks/useScheduleForm";
import { EmployeePicker } from "@/components/schedules/EmployeePicker";
import { StaffingGrid } from "@/components/schedules/StaffingGrid";
import { Button } from "@/components/ui/button";
import {
  PERIOD_DAYS,
  SCHEDULE_LABEL_MAX_LENGTH,
  SCHEDULE_MAX_DATE,
  SCHEDULE_MIN_DATE,
  formatPeriod,
  parseIsoDate,
} from "@/lib/services/schedule";
import type { EmployeeOption, Schedule, ShiftOption } from "@/types";

interface Props {
  /** Every shift of the dictionary, in the order to offer them. */
  shifts: ShiftOption[];
  /** Every employee, in the order to list them. */
  employees: EmployeeOption[];
  /** The schedule to edit; none for a new one. */
  schedule?: Schedule;
  /** How many assignments the schedule has; a new schedule has none. */
  assignmentCount?: number;
}

const hintClass = "mt-1 text-xs text-blue-100/50";
const RANGE_HINT_ID = "startDate-range";
const MOVE_NOTE_ID = "startDate-assignments";
const OUTCOME_UNKNOWN_NOTE =
  "Nie wiadomo, czy grafik został zapisany: nie przyszła odpowiedź z serwera. Zapis jest wyłączony, żeby nie utworzyć drugiego takiego samego grafiku. Najpierw sprawdź listę grafików.";

// The line under the date field: the seven days the typed date starts, or null while it is not a valid date.
function periodPreview(startDate: string): string | null {
  return parseIsoDate(startDate) ? `Okres: ${formatPeriod(startDate)}, ${PERIOD_DAYS} dni` : null;
}

// A shift that is in the stored schedule but no longer on the list: it keeps its row, so a save does not drop its cells.
function unavailableShift(id: string): ShiftOption {
  return { id, name: "(niedostępne)", times: "", endsNextDay: false, duration: "" };
}

export default function ScheduleForm({ shifts, employees, schedule, assignmentCount = 0 }: Props) {
  const form = useScheduleForm({ schedule, employees, assignmentCount });
  const { values, fieldErrors, serverError, pending, removal } = form;

  const inGrid = new Set(values.shiftIds);
  const offered = new Set(shifts.map((shift) => shift.id));
  // The rows follow the order of the shift list, whatever the order they were added in.
  const rows = [
    ...shifts.filter((shift) => inGrid.has(shift.id)),
    ...values.shiftIds.filter((id) => !offered.has(id)).map(unavailableShift),
  ];
  const addable = shifts.filter((shift) => !inGrid.has(shift.id));

  const listed = new Set(employees.map((employee) => employee.id));
  const unavailableEmployeeIds = (schedule?.employeeIds ?? []).filter((id) => !listed.has(id));
  const everyEmployeeId = [...employees.map((employee) => employee.id), ...unavailableEmployeeIds];

  return (
    <form className="space-y-6" onSubmit={form.submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FormField
            id="startDate"
            type="date"
            label="Data początkowa"
            value={values.startDate}
            onChange={form.setStartDate}
            error={fieldErrors.startDate}
            min={SCHEDULE_MIN_DATE}
            max={SCHEDULE_MAX_DATE}
            describedBy={form.assignmentsMove ? `${RANGE_HINT_ID} ${MOVE_NOTE_ID}` : RANGE_HINT_ID}
            icon={<CalendarDays className="size-4" />}
          />
          {/* Not the field's `hint`, which it hides while it shows an error: that error does not say the range. */}
          <p id={RANGE_HINT_ID} className={hintClass}>
            {`Dozwolone daty: ${SCHEDULE_MIN_DATE} do ${SCHEDULE_MAX_DATE}.`}
          </p>
          <p aria-live="polite" className="mt-1 text-sm text-blue-100/80">
            {periodPreview(values.startDate)}
          </p>
          {form.assignmentsMove ? (
            <p id={MOVE_NOTE_ID} className="mt-2 text-sm text-amber-100/90">
              {`Ten grafik ma przypisania pracowników (liczba: ${assignmentCount}). Zmiana daty przesunie je razem z całym tygodniem: zostają przy tych samych dniach siatki, więc dni tygodnia dostaną inne daty.`}
            </p>
          ) : null}
        </div>

        <FormField
          id="label"
          label="Etykieta (opcjonalna)"
          value={values.label}
          onChange={form.setLabel}
          error={fieldErrors.label}
          hint={
            <p className={hintClass}>
              {`Do ${SCHEDULE_LABEL_MAX_LENGTH} znaków. Pomaga odróżnić grafiki z tego samego okresu.`}
            </p>
          }
          autoComplete="off"
          icon={<Tag className="size-4" />}
        />
      </div>

      <StaffingGrid
        startDate={values.startDate}
        rows={rows}
        addable={addable}
        counts={values.counts}
        total={form.total}
        focusShiftId={form.focusShiftId}
        error={fieldErrors.staffing}
        onCountChange={form.setCount}
        onAdd={form.addShift}
        onRemove={form.removeShift}
      />

      <EmployeePicker
        employees={employees}
        unavailableIds={unavailableEmployeeIds}
        selected={values.employeeIds}
        error={fieldErrors.employeeIds}
        onToggle={form.toggleEmployee}
        onSelectAll={() => {
          form.setEmployeeIds(everyEmployeeId);
        }}
        onClearAll={() => {
          form.setEmployeeIds([]);
        }}
      />

      <ServerError message={serverError} />

      {form.outcomeUnknown ? (
        // The request to create the schedule got no answer. Another one could add it a second time, so the save stays off
        // until the planner has looked at the list. Only the sentence is the alert, as in the warning below.
        <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
          <p role="alert" className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {OUTCOME_UNKNOWN_NOTE}
          </p>
          <a href="/schedules" className="inline-block text-sm text-purple-300 hover:underline">
            Przejdź do listy grafików
          </a>
        </div>
      ) : null}

      {removal ? (
        // A warning, not an error: nothing is wrong with the form, the save only needs a yes. Only the sentence is the alert,
        // so a screen reader does not read the buttons out with it; the safe button takes the focus.
        <div className="space-y-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/90">
          <p role="alert" className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {`Zapis usunie przypisania pracowników. Liczba przypisań do usunięcia: ${removal.count}. Dotyczy zmiany lub osoby, którą usuwasz z grafiku.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={form.saveAndRemove}
              className="rounded-lg bg-amber-300 px-4 py-2 font-medium text-slate-900 transition-colors hover:bg-amber-200"
            >
              {pending ? "Zapisywanie..." : "Zapisz i usuń przypisania"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={form.backToEditing}
              autoFocus
              className="rounded-lg border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              Wróć do edycji
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-4 pt-2">
        <Button
          type="submit"
          disabled={pending || form.outcomeUnknown}
          className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {pending ? "Zapisywanie..." : "Zapisz"}
        </Button>
        <a href="/schedules" className="text-sm text-purple-300 hover:underline">
          Anuluj
        </a>
      </div>
    </form>
  );
}
