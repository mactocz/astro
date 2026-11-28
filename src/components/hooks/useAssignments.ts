import { useMemo, useRef, useState } from "react";
import { APPROVAL_MESSAGES } from "@/lib/services/approval";
import {
  assignmentKey,
  groupByEmployeeDay,
  summarizeCoverage,
  toAssignmentEntries,
  withEntry,
  withGeneratedEntries,
  withoutGeneratedEntries,
  type AssignmentEntries,
  type ShownAssignment,
} from "@/lib/services/assignment";
import type { Assignment, AssignmentInput, StaffingCell } from "@/types";

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const SAVE_ERROR = "Nie udało się zapisać przypisania. Spróbuj ponownie.";
const NOT_FOUND_ERROR = "Nie znaleziono tego grafiku. Wróć do listy grafików i spróbuj ponownie.";
const UNKNOWN_REFERENCE_ERROR =
  "Ta zmiana nie obowiązuje już tego dnia albo osoba nie należy do grafiku. Odśwież stronę.";

// The `error` code of an answer, or null when the body is not JSON or has none.
async function errorCode(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return body?.error ?? null;
  } catch {
    return null;
  }
}

async function failureMessage(response: Response): Promise<string> {
  switch (response.status) {
    case 401:
    case 403:
      return SESSION_ERROR;
    case 404:
      return NOT_FOUND_ERROR;
    case 409:
      return (await errorCode(response)) === "schedule_approved"
        ? `${APPROVAL_MESSAGES.schedule_approved} Odśwież stronę.`
        : SAVE_ERROR;
    case 422:
      // The cell has no staffing any more, or the person left the schedule.
      return (await errorCode(response)) === "unknown_reference" ? UNKNOWN_REFERENCE_ERROR : SAVE_ERROR;
    default:
      return SAVE_ERROR;
  }
}

/**
 * State of the assignment grid. Every click saves at once, with one request that adds (`POST`) or takes off (`DELETE`) one
 * assignment: the view changes first and goes back to what it was before that click when the request fails. `initial` is
 * what the page loaded; the coverage summary is counted from the current state against the staffing cells.
 *
 * Each entry keeps its `source` (S-09): a click adds a manual one, a stored proposal comes in with `addGenerated` and
 * `removeGenerated` takes every generated one off. Both change the view only; `useGeneration` calls them after the server
 * has done it.
 */
export function useAssignments({
  scheduleId,
  staffing,
  initial,
}: {
  scheduleId: string;
  staffing: readonly Pick<StaffingCell, "shiftId" | "dayOffset" | "requiredCount">[];
  initial: readonly ShownAssignment[];
}) {
  const [assigned, setAssigned] = useState<AssignmentEntries>(() => toAssignmentEntries(initial));
  const [error, setError] = useState<string | null>(null);
  // The keys with a request in flight. The ref is what a click asks (it changes at once, so a second click that arrives
  // before the next render is still caught); the state is a copy for the buttons to show `aria-busy`.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const list = useMemo(() => [...assigned.values()], [assigned]);
  const byEmployeeDay: Partial<Record<string, string[]>> = useMemo(() => groupByEmployeeDay(list), [list]);
  const coverage = useMemo(() => summarizeCoverage(staffing, list), [staffing, list]);
  const generatedKeys: ReadonlySet<string> = useMemo(
    () => new Set([...assigned].filter(([, { source }]) => source === "generated").map(([key]) => key)),
    [assigned],
  );

  // A click on a pressed button takes the assignment off, on any other it adds one. A click is ignored while a request for
  // the same employee, day and shift is in flight. A failure puts back only this one assignment as it was before the
  // click: other clicks may have succeeded in the meantime and are not undone.
  async function toggle(employeeId: string, dayOffset: number, shiftId: string) {
    const key = assignmentKey(employeeId, dayOffset, shiftId);
    if (inFlight.current.has(key)) {
      return;
    }
    const input: AssignmentInput = { shiftId, dayOffset, employeeId };
    const before = assigned.get(key);
    const after: Assignment | undefined = before ? undefined : { ...input, source: "manual" };
    inFlight.current.add(key);
    setBusy(new Set(inFlight.current));
    setAssigned((prev) => withEntry(prev, key, after));

    let failure: string | null = null;
    try {
      const response = await fetch(`/api/schedules/${scheduleId}/assignments`, {
        method: before ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status !== 200) {
        failure = await failureMessage(response);
      }
    } catch {
      failure = SAVE_ERROR;
    }

    inFlight.current.delete(key);
    setBusy(new Set(inFlight.current));
    if (failure === null) {
      setError(null);
    } else {
      setAssigned((prev) => withEntry(prev, key, before));
      setError(failure);
    }
  }

  function addGenerated(additions: readonly AssignmentInput[]) {
    setAssigned((prev) => withGeneratedEntries(prev, additions));
  }

  function removeGenerated() {
    setAssigned(withoutGeneratedEntries);
  }

  return { list, byEmployeeDay, coverage, generatedKeys, busy, error, toggle, addGenerated, removeGenerated };
}
