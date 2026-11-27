import { isUuid } from "@/lib/postgrest";
import { PERIOD_DAYS, compareCells, compareText } from "@/lib/services/schedule";
import type { AssignmentField, AssignmentFieldErrors, AssignmentInput, CoverageCell, StaffingCell } from "@/types";

// One short message per field, shown next to the field and returned by the API.
const FIELD_ERRORS = {
  shiftId: "Wybierz zmianę.",
  dayOffset: "Wybierz dzień grafiku.",
  employeeId: "Wybierz pracownika.",
} as const satisfies Record<AssignmentField, string>;

type Parsed<T> = { ok: true; value: T } | { ok: false };

type CellRef = Pick<AssignmentInput, "shiftId" | "dayOffset">;

// A staffing cell is one shift on one day.
function cellKey({ shiftId, dayOffset }: CellRef): string {
  return `${shiftId}/${dayOffset}`;
}

function compareAssignments(a: AssignmentInput, b: AssignmentInput): number {
  return compareCells(a, b) || compareText(a.employeeId, b.employeeId);
}

// UUIDs compare case-insensitively in the database, so they are kept in lower case here.
function parseId(value: unknown): Parsed<string> {
  return typeof value === "string" && isUuid(value) ? { ok: true, value: value.toLowerCase() } : { ok: false };
}

function parseDayOffset(value: unknown): Parsed<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > PERIOD_DAYS - 1) {
    return { ok: false };
  }
  // A JSON -0 becomes 0.
  return { ok: true, value: value === 0 ? 0 : value };
}

/**
 * Validates and normalises a raw assignment with the keys `shiftId`, `dayOffset` (0 to 6) and `employeeId`. Anything
 * that is not an object counts as empty fields, and other keys (such as a `source`) are left out of the value. Every
 * invalid field is reported at once, each with one message. It only checks the shape: that the cell and the employee
 * exist is left to the foreign keys in the database.
 */
export function validateAssignmentInput(
  raw: unknown,
): { ok: true; value: AssignmentInput } | { ok: false; errors: AssignmentFieldErrors } {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const shiftId = parseId(input.shiftId);
  const dayOffset = parseDayOffset(input.dayOffset);
  const employeeId = parseId(input.employeeId);

  if (!shiftId.ok || !dayOffset.ok || !employeeId.ok) {
    const errors: AssignmentFieldErrors = {};
    if (!shiftId.ok) {
      errors.shiftId = FIELD_ERRORS.shiftId;
    }
    if (!dayOffset.ok) {
      errors.dayOffset = FIELD_ERRORS.dayOffset;
    }
    if (!employeeId.ok) {
      errors.employeeId = FIELD_ERRORS.employeeId;
    }
    return { ok: false, errors };
  }
  return { ok: true, value: { shiftId: shiftId.value, dayOffset: dayOffset.value, employeeId: employeeId.value } };
}

/** What the page sends to store a proposal (S-09): what it has on the screen and the assignments to add. */
export interface GenerationRequest {
  basis: string;
  assignments: AssignmentInput[];
  additions: AssignmentInput[];
}

// Every item validated and normalised, or null when the value is not a list of assignments.
function readAssignmentList(value: unknown): AssignmentInput[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const read: AssignmentInput[] = [];
  for (const item of value) {
    const result = validateAssignmentInput(item);
    if (!result.ok) {
      return null;
    }
    read.push(result.value);
  }
  return read;
}

/**
 * The body of a request that stores a proposal, `{ basis, assignments, additions }`, or null when it is not one: `basis`
 * is a string, both lists hold only valid assignments and `additions` is not empty. Other keys are left out. It only
 * checks the shape: whether the page is up to date and the cells exist is decided against the database.
 */
export function readGenerationRequest(body: unknown): GenerationRequest | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { basis, assignments, additions } = body as Record<string, unknown>;
  const shown = readAssignmentList(assignments);
  const added = readAssignmentList(additions);
  if (typeof basis !== "string" || shown === null || added === null || added.length === 0) {
    return null;
  }
  return { basis, assignments: shown, additions: added };
}

/**
 * A new list ordered by shift id, then day, then employee id. The result does not depend on the order of `list`, which is
 * left unchanged. Works on any item with these keys, so on a full assignment as well as on an input.
 */
export function sortAssignments<T extends AssignmentInput>(list: readonly T[]): T[] {
  return [...list].sort(compareAssignments);
}

/** The key of one employee on one day, the key of the object that `groupByEmployeeDay` returns. */
export function employeeDayKey(employeeId: string, dayOffset: number): string {
  return `${employeeId}/${dayOffset}`;
}

/**
 * For each employee and day, the ids of the shifts they are assigned to: sorted and without repeats. A pair without an
 * assignment has no entry. The keys come from `employeeDayKey` and are in sorted order, so the same data in any order
 * gives the same object.
 */
export function groupByEmployeeDay(assignments: readonly AssignmentInput[]): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  // Sorted by shift id first, so the shifts of one employee and day arrive in order and a repeat is always the last one.
  for (const { shiftId, dayOffset, employeeId } of sortAssignments(assignments)) {
    const key = employeeDayKey(employeeId, dayOffset);
    const shiftIds = groups.get(key);
    if (shiftIds === undefined) {
      groups.set(key, [shiftId]);
    } else if (shiftIds[shiftIds.length - 1] !== shiftId) {
      shiftIds.push(shiftId);
    }
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => compareText(a, b)));
}

/**
 * One element per staffing cell, ordered by shift id, then day. `assigned` is the number of different employees on the
 * cell (the same assignment twice counts once), `missing` and `surplus` are the shortfall and the excess against the
 * required count, never negative. An assignment on a day and shift without a staffing cell is left out. The staffing
 * grid has one cell per shift and day, so a repeated cell would give a repeated element.
 */
export function summarizeCoverage(
  staffing: readonly Pick<StaffingCell, "shiftId" | "dayOffset" | "requiredCount">[],
  assignments: readonly AssignmentInput[],
): CoverageCell[] {
  const employeesByCell = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const key = cellKey(assignment);
    const employees = employeesByCell.get(key);
    if (employees === undefined) {
      employeesByCell.set(key, new Set([assignment.employeeId]));
    } else {
      employees.add(assignment.employeeId);
    }
  }
  return [...staffing].sort(compareCells).map(({ shiftId, dayOffset, requiredCount }) => {
    const assigned = employeesByCell.get(cellKey({ shiftId, dayOffset }))?.size ?? 0;
    return {
      shiftId,
      dayOffset,
      required: requiredCount,
      assigned,
      missing: Math.max(requiredCount - assigned, 0),
      surplus: Math.max(assigned - requiredCount, 0),
    };
  });
}
