import { useState, type SubmitEvent } from "react";
import {
  PERIOD_DAYS,
  SCHEDULE_LABEL_MAX_LENGTH,
  STAFFING_MAX,
  totalRequired,
  validateScheduleInput,
} from "@/lib/services/schedule";
import type {
  EmployeeOption,
  Schedule,
  ScheduleField,
  ScheduleFieldErrors,
  ScheduleInput,
  StaffingCell,
} from "@/types";

export interface ScheduleFormValues {
  startDate: string;
  label: string;
  /** The shifts that have a row in the grid, in the order they were added. */
  shiftIds: string[];
  /** The text typed into each cell of the grid, by `countKey`; a cell nobody has touched has no entry. */
  counts: Partial<Record<string, string>>;
  /** The employees that are ticked. */
  employeeIds: string[];
}

/**
 * A save that the server refused because it would delete assignments with a cell or a person: how many it would delete,
 * and the already validated value to send again once the planner confirms.
 */
export interface PendingRemoval {
  count: number;
  value: ScheduleInput;
}

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const SAVE_ERROR = "Nie udało się zapisać. Spróbuj ponownie.";
const NOT_FOUND_ERROR = "Nie znaleziono tego grafiku. Wróć do listy grafików i spróbuj ponownie.";
const UNKNOWN_REFERENCE_ERROR =
  "Zmiana lub pracownik z formularza już nie istnieje. Odśwież stronę i spróbuj ponownie.";

/** The key of one cell of the grid in `ScheduleFormValues.counts`. */
export function countKey(shiftId: string, dayOffset: number): string {
  return `${shiftId}:${dayOffset}`;
}

// A new schedule starts empty with every employee ticked; a stored one fills the form from what was saved. The grid
// rows are the shifts that have a cell, so a shift that was added to the grid with zeros only does not survive a save.
function initialValues(schedule: Schedule | undefined, employees: readonly EmployeeOption[]): ScheduleFormValues {
  if (!schedule) {
    return {
      startDate: "",
      label: "",
      shiftIds: [],
      counts: {},
      employeeIds: employees.map((employee) => employee.id),
    };
  }
  return {
    startDate: schedule.startDate,
    label: schedule.label ?? "",
    shiftIds: [...new Set(schedule.staffing.map((cell) => cell.shiftId))],
    counts: Object.fromEntries(
      schedule.staffing.map((cell) => [countKey(cell.shiftId, cell.dayOffset), String(cell.requiredCount)]),
    ),
    employeeIds: [...schedule.employeeIds],
  };
}

// What the grid sends. A cell that is empty or 0 means no shift that day and is left out; any other text goes as the
// number it says, even one that validateScheduleInput refuses (100, 1.5, or NaN for rubbish), so the form and the server
// give the same answer.
function staffingOf(values: ScheduleFormValues): StaffingCell[] {
  const cells: StaffingCell[] = [];
  for (const shiftId of values.shiftIds) {
    for (let dayOffset = 0; dayOffset < PERIOD_DAYS; dayOffset++) {
      const requiredCount = Number((values.counts[countKey(shiftId, dayOffset)] ?? "").trim());
      if (requiredCount !== 0) {
        cells.push({ shiftId, dayOffset, requiredCount });
      }
    }
  }
  return cells;
}

const FIELD_ORDER: readonly ScheduleField[] = ["startDate", "label", "staffing", "employeeIds"];

// Puts the keyboard focus on the first field with an error (the date and label inputs and the two groups carry the field
// names as ids), so a screen reader starts there instead of staying silent on the button.
function focusFirstInvalid(errors: ScheduleFieldErrors) {
  const field = FIELD_ORDER.find((name) => errors[name]);
  if (field) {
    document.getElementById(field)?.focus();
  }
}

interface ErrorBody {
  errors: ScheduleFieldErrors | null;
  unknownReference: boolean;
  /** The number of assignments the save would delete, from a 409 `assignments_would_be_removed`; null for anything else. */
  removed: number | null;
}

// The `errors` of a 422 answer, whether it is the `unknown_reference` one, and the `removed` of a 409 answer (a whole
// number of 1 or more, or it is no confirmation to ask for); none of them when the body is not JSON.
async function readErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const body = (await response.json()) as { errors?: unknown; error?: unknown; removed?: unknown } | null;
    return {
      errors: typeof body?.errors === "object" && body.errors !== null ? body.errors : null,
      unknownReference: body?.error === "unknown_reference",
      removed:
        body?.error === "assignments_would_be_removed" &&
        typeof body.removed === "number" &&
        Number.isInteger(body.removed) &&
        body.removed >= 1
          ? body.removed
          : null,
    };
  } catch {
    return { errors: null, unknownReference: false, removed: null };
  }
}

/**
 * State and submit handler of the schedule form. The rules live in `validateScheduleInput`, the same function the API
 * routes call, so the form shows what the server would say; the server still validates again. `assignmentCount` is how
 * many assignments the stored schedule has (0 for a new one).
 */
export function useScheduleForm({
  schedule,
  employees,
  assignmentCount,
}: {
  schedule?: Schedule;
  employees: readonly EmployeeOption[];
  assignmentCount: number;
}) {
  const [values, setValues] = useState(() => initialValues(schedule, employees));
  const [fieldErrors, setFieldErrors] = useState<ScheduleFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The shift added last: the first cell of its row takes the keyboard focus when the row appears.
  const [focusShiftId, setFocusShiftId] = useState<string | null>(null);
  // Set when the server refused a save that would delete assignments; the form then asks for a confirmation. Any change to
  // a value clears it (the server asks again if the number differs for the new value).
  const [removal, setRemoval] = useState<PendingRemoval | null>(null);

  function clearError(field: ScheduleField) {
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function setStartDate(value: string) {
    setValues((prev) => ({ ...prev, startDate: value }));
    setRemoval(null);
    clearError("startDate");
  }

  function setLabel(value: string) {
    // The limit counts characters (code points), like the server and the database; the `maxLength` attribute would count
    // UTF-16 units and stop a label with emoji too early.
    setValues((prev) => ({ ...prev, label: Array.from(value).slice(0, SCHEDULE_LABEL_MAX_LENGTH).join("") }));
    setRemoval(null);
    clearError("label");
  }

  // The grid errors depend on every row and cell (an empty grid, a bad number), so any change to the grid clears them.
  function addShift(shiftId: string) {
    setValues((prev) => (prev.shiftIds.includes(shiftId) ? prev : { ...prev, shiftIds: [...prev.shiftIds, shiftId] }));
    setFocusShiftId(shiftId);
    setRemoval(null);
    clearError("staffing");
  }

  function removeShift(shiftId: string) {
    setValues((prev) => ({
      ...prev,
      shiftIds: prev.shiftIds.filter((id) => id !== shiftId),
      // The numbers of a removed row go with it, so adding the shift again starts from an empty row.
      counts: Object.fromEntries(Object.entries(prev.counts).filter(([key]) => !key.startsWith(`${shiftId}:`))),
    }));
    setRemoval(null);
    clearError("staffing");
  }

  function setCount(shiftId: string, dayOffset: number, value: string) {
    setValues((prev) => ({ ...prev, counts: { ...prev.counts, [countKey(shiftId, dayOffset)]: value } }));
    setRemoval(null);
    clearError("staffing");
  }

  function toggleEmployee(employeeId: string, checked: boolean) {
    setValues((prev) => ({
      ...prev,
      employeeIds: checked
        ? [...new Set([...prev.employeeIds, employeeId])]
        : prev.employeeIds.filter((id) => id !== employeeId),
    }));
    setRemoval(null);
    clearError("employeeIds");
  }

  function setEmployeeIds(employeeIds: string[]) {
    setValues((prev) => ({ ...prev, employeeIds }));
    setRemoval(null);
    clearError("employeeIds");
  }

  // `confirmRemoval` is true only when the planner has confirmed a refused save: the body then carries `confirmRemoval:
  // true`, and the server deletes the assignments of the cells and people the value leaves out.
  async function save(value: ScheduleInput, confirmRemoval = false) {
    setFieldErrors({});
    setServerError(null);
    setPending(true);
    // What to ask the planner to confirm once this save is over. A retry leaves the old question on screen while it runs
    // and replaces it with the answer: the new count when the server refuses again, nothing for any other outcome.
    let refused: PendingRemoval | null = null;
    try {
      const response = await fetch(schedule ? `/api/schedules/${schedule.id}` : "/api/schedules", {
        method: schedule ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmRemoval ? { ...value, confirmRemoval: true } : value),
      });
      if (response.status === 200 || response.status === 201) {
        // Stays pending until the page is gone, so a second click cannot save twice. `replace` keeps the saved form out
        // of the history: these pages are not cached, but Back could still restore the form with the button disabled.
        window.location.replace("/schedules");
        return;
      }
      if (response.status === 409) {
        // Nothing was stored. A 409 that does not say how many assignments it is about is no question to put to the
        // planner, so it is a failed save like any other.
        const body = await readErrorBody(response);
        if (body.removed === null) {
          setServerError(SAVE_ERROR);
        } else {
          refused = { count: body.removed, value };
        }
      } else if (response.status === 422) {
        const body = await readErrorBody(response);
        if (body.errors) {
          setFieldErrors(body.errors);
          focusFirstInvalid(body.errors);
        } else {
          setServerError(body.unknownReference ? UNKNOWN_REFERENCE_ERROR : SAVE_ERROR);
        }
      } else if (response.status === 404) {
        setServerError(NOT_FOUND_ERROR);
      } else {
        setServerError(response.status === 401 || response.status === 403 ? SESSION_ERROR : SAVE_ERROR);
      }
    } catch {
      setServerError(SAVE_ERROR);
    }
    setRemoval(refused);
    setPending(false);
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const validation = validateScheduleInput({
      startDate: values.startDate,
      label: values.label,
      staffing: staffingOf(values),
      employeeIds: values.employeeIds,
    });
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      focusFirstInvalid(validation.errors);
      return;
    }
    // The normalised value is what goes to the server: the cells and the people in a fixed order, the label collapsed.
    await save(validation.value);
  }

  // The planner confirmed: the value the server refused goes again, this time with the confirmation.
  async function saveAndRemove() {
    if (pending || !removal) {
      return;
    }
    await save(removal.value, true);
  }

  function backToEditing() {
    setRemoval(null);
  }

  // The assignments hang on the days of the grid (offsets from the start date), not on calendar dates, so another start
  // date moves them to other dates. An empty date field counts as another date, too. The planner is told, not stopped.
  const assignmentsMove = assignmentCount > 0 && schedule !== undefined && values.startDate !== schedule.startDate;

  // The sum under the grid counts only the cells that would pass validation, so a half-typed number is not added up.
  const total = totalRequired(
    staffingOf(values).filter(
      (cell) => Number.isInteger(cell.requiredCount) && cell.requiredCount >= 1 && cell.requiredCount <= STAFFING_MAX,
    ),
  );

  return {
    values,
    fieldErrors,
    serverError,
    pending,
    focusShiftId,
    total,
    removal,
    assignmentsMove,
    setStartDate,
    setLabel,
    addShift,
    removeShift,
    setCount,
    toggleEmployee,
    setEmployeeIds,
    submit,
    saveAndRemove,
    backToEditing,
  };
}
