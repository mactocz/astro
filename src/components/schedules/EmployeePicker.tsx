import { CircleAlert } from "lucide-react";
import type { EmployeeOption } from "@/types";

interface Props {
  employees: readonly EmployeeOption[];
  /** Employees the schedule has but the roster no longer offers: shown ticked, so a save does not drop them silently. */
  unavailableIds: readonly string[];
  /** The ids that are ticked. */
  selected: readonly string[];
  error?: string;
  onToggle: (employeeId: string, checked: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

const ERROR_ID = "employeeIds-error";
const linkButtonClass = "py-1 text-sm text-purple-300 transition-colors hover:text-purple-100 hover:underline";

export function EmployeePicker({
  employees,
  unavailableIds,
  selected,
  error,
  onToggle,
  onSelectAll,
  onClearAll,
}: Props) {
  const choices = [
    ...employees.map((employee) => ({ id: employee.id, name: employee.name })),
    // The start of the id tells apart two people that are gone.
    ...unavailableIds.map((id) => ({ id, name: `(niedostępne) ${id.slice(0, 8)}` })),
  ];
  const ticked = new Set(selected);
  const tickedCount = choices.filter((choice) => ticked.has(choice.id)).length;

  return (
    <fieldset
      id="employeeIds"
      tabIndex={-1}
      aria-describedby={error ? ERROR_ID : undefined}
      className="min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
    >
      <legend className="mb-1 text-sm text-blue-100/80">Pracownicy w grafiku</legend>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={onSelectAll} className={linkButtonClass}>
          Zaznacz wszystkich
        </button>
        <button type="button" onClick={onClearAll} className={linkButtonClass}>
          Odznacz wszystkich
        </button>
        <span aria-live="polite" className="text-xs text-blue-100/50">
          {`Wybrano: ${tickedCount} z ${choices.length}`}
        </span>
      </div>
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {choices.map((choice) => (
          <li key={choice.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white hover:bg-white/10">
              <input
                type="checkbox"
                name="employeeIds"
                value={choice.id}
                checked={ticked.has(choice.id)}
                onChange={(e) => {
                  onToggle(choice.id, e.target.checked);
                }}
                className="size-4 shrink-0 accent-purple-500"
              />
              <span className="break-words">{choice.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {error ? (
        <p id={ERROR_ID} role="alert" className="mt-2 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
