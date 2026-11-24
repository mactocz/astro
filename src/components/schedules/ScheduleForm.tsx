import { CalendarDays, Tag } from "lucide-react";
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
}

const hintClass = "mt-1 text-xs text-blue-100/50";

// The line under the date field: the seven days the typed date starts, or null while it is not a valid date.
function periodPreview(startDate: string): string | null {
  return parseIsoDate(startDate) ? `Okres: ${formatPeriod(startDate)}, ${PERIOD_DAYS} dni` : null;
}

// A shift that is in the stored schedule but no longer on the list: it keeps its row, so a save does not drop its cells.
function unavailableShift(id: string): ShiftOption {
  return { id, name: "(niedostępne)", times: "", endsNextDay: false, duration: "" };
}

export default function ScheduleForm({ shifts, employees, schedule }: Props) {
  const form = useScheduleForm({ schedule, employees });
  const { values, fieldErrors, serverError, pending } = form;

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
            icon={<CalendarDays className="size-4" />}
          />
          <p aria-live="polite" className="mt-1 text-sm text-blue-100/80">
            {periodPreview(values.startDate)}
          </p>
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

      <div className="flex items-center gap-4 pt-2">
        <Button
          type="submit"
          disabled={pending}
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
