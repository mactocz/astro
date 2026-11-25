import { useMemo, useRef, useState } from "react";
import { employeeDayKey, groupByEmployeeDay, summarizeCoverage } from "@/lib/services/assignment";
import type { AssignmentInput, StaffingCell } from "@/types";

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const SAVE_ERROR = "Nie udało się zapisać przypisania. Spróbuj ponownie.";
const NOT_FOUND_ERROR = "Nie znaleziono tego grafiku. Wróć do listy grafików i spróbuj ponownie.";
const UNKNOWN_REFERENCE_ERROR =
  "Ta zmiana nie obowiązuje już tego dnia albo osoba nie należy do grafiku. Odśwież stronę.";

type AssignmentSet = ReadonlyMap<string, AssignmentInput>;

/** The key of one assignment (employee, day and shift): the key of the state and of the set of requests in flight. */
export function assignmentKey(employeeId: string, dayOffset: number, shiftId: string): string {
  return `${employeeDayKey(employeeId, dayOffset)}/${shiftId}`;
}

// The set with the assignment there or not there, as asked; the same set when it already is as asked.
function withPresence(set: AssignmentSet, key: string, input: AssignmentInput, present: boolean): AssignmentSet {
  if (set.has(key) === present) {
    return set;
  }
  const next = new Map(set);
  if (present) {
    next.set(key, input);
  } else {
    next.delete(key);
  }
  return next;
}

// Whether a 422 answer is the `unknown_reference` one (the cell has no staffing any more, or the person left the schedule);
// false when the body is not JSON.
async function isUnknownReference(response: Response): Promise<boolean> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return body?.error === "unknown_reference";
  } catch {
    return false;
  }
}

async function failureMessage(response: Response): Promise<string> {
  switch (response.status) {
    case 401:
    case 403:
      return SESSION_ERROR;
    case 404:
      return NOT_FOUND_ERROR;
    case 422:
      return (await isUnknownReference(response)) ? UNKNOWN_REFERENCE_ERROR : SAVE_ERROR;
    default:
      return SAVE_ERROR;
  }
}

/**
 * State of the assignment grid. Every click saves at once, with one request that adds (`POST`) or takes off (`DELETE`) one
 * assignment: the view changes first and goes back to what it was before that click when the request fails. `initial` is
 * what the page loaded; the coverage summary is counted from the current state against the staffing cells.
 */
export function useAssignments({
  scheduleId,
  staffing,
  initial,
}: {
  scheduleId: string;
  staffing: readonly Pick<StaffingCell, "shiftId" | "dayOffset" | "requiredCount">[];
  initial: readonly AssignmentInput[];
}) {
  const [assigned, setAssigned] = useState<AssignmentSet>(
    () =>
      new Map(
        initial.map(({ shiftId, dayOffset, employeeId }) => [
          assignmentKey(employeeId, dayOffset, shiftId),
          { shiftId, dayOffset, employeeId },
        ]),
      ),
  );
  const [error, setError] = useState<string | null>(null);
  // The keys with a request in flight. The ref is what a click asks (it changes at once, so a second click that arrives
  // before the next render is still caught); the state is a copy for the buttons to show `aria-busy`.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const list = useMemo(() => [...assigned.values()], [assigned]);
  const byEmployeeDay: Partial<Record<string, string[]>> = useMemo(() => groupByEmployeeDay(list), [list]);
  const coverage = useMemo(() => summarizeCoverage(staffing, list), [staffing, list]);

  // A click on a pressed button takes the assignment off, on any other it adds one. A click is ignored while a request for
  // the same employee, day and shift is in flight. A failure puts back only this one assignment as it was before the
  // click: other clicks may have succeeded in the meantime and are not undone.
  async function toggle(employeeId: string, dayOffset: number, shiftId: string) {
    const key = assignmentKey(employeeId, dayOffset, shiftId);
    if (inFlight.current.has(key)) {
      return;
    }
    const input: AssignmentInput = { shiftId, dayOffset, employeeId };
    const wasAssigned = assigned.has(key);
    inFlight.current.add(key);
    setBusy(new Set(inFlight.current));
    setAssigned((prev) => withPresence(prev, key, input, !wasAssigned));

    let failure: string | null = null;
    try {
      const response = await fetch(`/api/schedules/${scheduleId}/assignments`, {
        method: wasAssigned ? "DELETE" : "POST",
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
      setAssigned((prev) => withPresence(prev, key, input, wasAssigned));
      setError(failure);
    }
  }

  return { list, byEmployeeDay, coverage, busy, error, toggle };
}
