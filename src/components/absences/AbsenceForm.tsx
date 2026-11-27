import { CalendarDays, CircleAlert, User } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { useAbsenceForm, type EditedAbsence } from "@/components/hooks/useAbsenceForm";
import { Button } from "@/components/ui/button";
import { ABSENCE_TYPES } from "@/lib/services/absence";
import { SCHEDULE_MAX_DATE, SCHEDULE_MIN_DATE } from "@/lib/services/schedule";
import { cn } from "@/lib/utils";
import type { EmployeeOption } from "@/types";

interface Props {
  /** The people to pick from. The edit form needs only the person of the absence: it only shows the name. */
  employees: readonly EmployeeOption[];
  /** The absence to correct; without it the form adds a new one. */
  absence?: EditedAbsence;
}

const hintClass = "mt-1 text-xs text-blue-100/50";
const RANGE_HINT_ID = "absence-range";
const PERSON_LOCKED_ID = "employeeId-locked";
const UNKNOWN_PERSON = "Nieznany pracownik";
const RANGE_HINT = `Dozwolone daty: ${SCHEDULE_MIN_DATE} do ${SCHEDULE_MAX_DATE}. Nieobecność obejmuje cały pierwszy i cały ostatni dzień.`;

// The person of an existing absence is shown, not edited: nothing is typed into the field.
function ignoreChange() {
  return undefined;
}

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The entry for "nothing picked yet"; its value is the empty string, which the validation refuses. */
  placeholder: string;
  options: readonly { value: string; label: string }[];
  error?: string;
}

// A native list, like the one that adds a shift to the staffing grid: it works with the keyboard and on a phone without any
// script. FormField has no list, so the label, the error and the aria attributes of its input are repeated here.
function SelectField({ id, label, value, onChange, placeholder, options, error }: SelectFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-blue-100/80">
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "w-full rounded-lg border bg-white/10 px-3 py-2 text-white [color-scheme:dark] transition-colors focus:ring-2 focus:outline-none",
          error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function AbsenceForm({ employees, absence }: Props) {
  const { values, fieldErrors, serverError, pending, setField, submit } = useAbsenceForm({ absence });

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {absence ? (
        // The person is only shown. The input keeps the id `employeeId` that the list of the add form has.
        <FormField
          id="employeeId"
          name="employeeName"
          label="Pracownik"
          value={employees.find((employee) => employee.id === absence.employeeId)?.name ?? UNKNOWN_PERSON}
          onChange={ignoreChange}
          readOnly
          describedBy={PERSON_LOCKED_ID}
          hint={
            <p id={PERSON_LOCKED_ID} className={hintClass}>
              Osoby nie można zmienić. Usuń nieobecność i dodaj nową.
            </p>
          }
          icon={<User className="size-4" />}
        />
      ) : (
        <SelectField
          id="employeeId"
          label="Pracownik"
          value={values.employeeId}
          onChange={(value) => {
            setField("employeeId", value);
          }}
          placeholder="Wybierz pracownika"
          options={employees.map((employee) => ({ value: employee.id, label: employee.name }))}
          error={fieldErrors.employeeId}
        />
      )}

      <SelectField
        id="type"
        label="Rodzaj nieobecności"
        value={values.type}
        onChange={(value) => {
          setField("type", value);
        }}
        placeholder="Wybierz rodzaj nieobecności"
        options={ABSENCE_TYPES}
        error={fieldErrors.type}
      />

      <div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="startDate"
            type="date"
            label="Data początku"
            value={values.startDate}
            onChange={(value) => {
              setField("startDate", value);
            }}
            error={fieldErrors.startDate}
            min={SCHEDULE_MIN_DATE}
            max={SCHEDULE_MAX_DATE}
            describedBy={RANGE_HINT_ID}
            icon={<CalendarDays className="size-4" />}
          />
          <FormField
            id="endDate"
            type="date"
            label="Data końca"
            value={values.endDate}
            onChange={(value) => {
              setField("endDate", value);
            }}
            error={fieldErrors.endDate}
            min={SCHEDULE_MIN_DATE}
            max={SCHEDULE_MAX_DATE}
            describedBy={RANGE_HINT_ID}
            icon={<CalendarDays className="size-4" />}
          />
        </div>
        {/* Not the `hint` of a field, which a field hides while it shows an error: that error does not say the range. */}
        <p id={RANGE_HINT_ID} className={hintClass}>
          {RANGE_HINT}
        </p>
      </div>

      <ServerError message={serverError} />

      <div className="flex items-center gap-4 pt-2">
        <Button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {pending ? "Zapisywanie..." : "Zapisz"}
        </Button>
        <a href="/absences" className="text-sm text-purple-300 hover:underline">
          Anuluj
        </a>
      </div>
    </form>
  );
}
