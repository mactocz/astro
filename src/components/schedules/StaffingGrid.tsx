import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { countKey } from "@/components/hooks/useScheduleForm";
import { Button } from "@/components/ui/button";
import { PERIOD_DAYS, STAFFING_MAX, dayColumns, parseIsoDate } from "@/lib/services/schedule";
import { cn } from "@/lib/utils";
import type { ShiftOption } from "@/types";

interface Props {
  /** The start date as typed; until it is a valid date the columns are only numbered. */
  startDate: string;
  /** The shifts that have a row, in the order to show them. */
  rows: readonly ShiftOption[];
  /** The shifts that can still be added. */
  addable: readonly ShiftOption[];
  counts: Partial<Record<string, string>>;
  total: number;
  /** The shift whose row has just been added: its first cell takes the focus. */
  focusShiftId: string | null;
  error?: string;
  onCountChange: (shiftId: string, dayOffset: number, value: string) => void;
  onAdd: (shiftId: string) => void;
  onRemove: (shiftId: string) => void;
}

const ERROR_ID = "staffing-error";
const ADD_SELECT_ID = "addShift";
// The first column stays in place while the days scroll. Its background is opaque (the card behind it is not), or the
// scrolled cells would show through.
const stickyCell = "sticky left-0 z-10 min-w-44 max-w-56 border-r border-white/10 bg-slate-800";
// The cell is a text input with a numeric keypad, not `type="number"`: a number input hands over "" for what it cannot read
// ("1e", "-", "+5"), and the form could not tell that from an empty cell. The form reads the text itself (`parseCount`).
const cellInputClass =
  "w-14 rounded-md border border-white/20 bg-white/10 px-1 py-1.5 text-center text-white transition-colors [color-scheme:dark] focus:ring-2 focus:ring-purple-400 focus:outline-none";

// "Nocna 22:00–06:00, następnego dnia, 8 h": the name, the hours, the mark of a shift past midnight and the length.
function optionText(shift: ShiftOption): string {
  const nextDay = shift.endsNextDay ? ", następnego dnia" : "";
  return `${shift.name} ${shift.times}${nextDay}, ${shift.duration}`;
}

// The name and the hours, which tell apart two shifts that share a name. A shift that is gone has no hours to show.
function shiftTitle(shift: ShiftOption): string {
  return shift.times ? `${shift.name} ${shift.times}` : shift.name;
}

export function StaffingGrid({
  startDate,
  rows,
  addable,
  counts,
  total,
  focusShiftId,
  error,
  onCountChange,
  onAdd,
  onRemove,
}: Props) {
  // The shift picked in the list but not added yet. Adding takes a button: a closed list changes its value on every arrow
  // key in some browsers, and that must not add a row each time.
  const [chosen, setChosen] = useState("");
  const columns = parseIsoDate(startDate)
    ? dayColumns(startDate).map((column) => ({ offset: column.offset, label: column.label }))
    : Array.from({ length: PERIOD_DAYS }, (_unused, offset) => ({ offset, label: `Dzień ${offset + 1}` }));

  function addChosen() {
    if (chosen === "") {
      return;
    }
    onAdd(chosen);
    setChosen("");
  }

  return (
    <fieldset
      id="staffing"
      tabIndex={-1}
      aria-describedby={error ? ERROR_ID : undefined}
      className="min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
    >
      <legend className="mb-1 text-sm text-blue-100/80">Obsada</legend>
      <p className="mb-2 text-xs text-blue-100/50">
        Ile osób potrzeba na zmianie danego dnia (od 1 do {STAFFING_MAX}). Puste pole lub 0 oznacza, że tego dnia nie ma
        takiej zmiany.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/20 px-4 py-6 text-center text-sm text-blue-100/60">
          Dodaj zmianę, żeby wpisać obsadę.
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
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
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className={cn(stickyCell, "border-t px-3 py-2 text-left font-normal")}>
                    <span className="block font-semibold break-words text-white">{row.name}</span>
                    {row.times ? (
                      <span className="block text-xs text-blue-100/60">
                        {row.times}
                        {row.endsNextDay ? ", następnego dnia" : ""}, {row.duration}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Usuń zmianę: ${shiftTitle(row)}`}
                      onClick={() => {
                        onRemove(row.id);
                      }}
                      className="mt-1 py-1 text-xs text-red-300 transition-colors hover:text-red-200 hover:underline"
                    >
                      Usuń
                    </button>
                  </th>
                  {columns.map((column) => {
                    const id = `cell-${row.id}-${column.offset}`;
                    return (
                      <td key={column.offset} className="border-t border-white/10 px-1 py-2 text-center">
                        <input
                          id={id}
                          name={id}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={counts[countKey(row.id, column.offset)] ?? ""}
                          onChange={(e) => {
                            onCountChange(row.id, column.offset, e.target.value);
                          }}
                          aria-label={`${shiftTitle(row)}, ${column.label}`}
                          autoFocus={row.id === focusShiftId && column.offset === 0}
                          className={cellInputClass}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p aria-live="polite" className="mt-2 text-sm text-blue-100/80">
        {`Suma obsady: ${total}`}
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label htmlFor={ADD_SELECT_ID} className="mb-1 block text-sm text-blue-100/80">
            Dodaj zmianę
          </label>
          <select
            id={ADD_SELECT_ID}
            value={chosen}
            disabled={addable.length === 0}
            onChange={(e) => {
              setChosen(e.target.value);
            }}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white [color-scheme:dark] focus:ring-2 focus:ring-purple-400 focus:outline-none disabled:opacity-50"
          >
            <option value="">{addable.length === 0 ? "Wszystkie zmiany są już w siatce" : "Wybierz zmianę"}</option>
            {addable.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {optionText(shift)}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={chosen === ""}
          onClick={addChosen}
          className="rounded-lg border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
        >
          Dodaj
        </Button>
      </div>

      {error ? (
        <p id={ERROR_ID} role="alert" className="mt-2 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3 shrink-0" />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
