import { isUuid } from "@/lib/postgrest";
import { PERIOD_DAYS } from "@/lib/services/schedule";
import type { AssignmentField, AssignmentFieldErrors, AssignmentInput, CoverageCell, StaffingCell } from "@/types";

// One short message per field, shown next to the field and returned by the API.
const FIELD_ERRORS = {
  shiftId: "Wybierz zmianę.",
  dayOffset: "Wybierz dzień grafiku.",
  employeeId: "Wybierz pracownika.",
} as const satisfies Record<AssignmentField, string>;

type Parsed<T> = { ok: true; value: T } | { ok: false };

// Plain code-unit order rather than a collator: an id is not text for people, and this never depends on locale data.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type CellRef = Pick<AssignmentInput, "shiftId" | "dayOffset">;

function compareCells(a: CellRef, b: CellRef): number {
  return compareText(a.shiftId, b.shiftId) || a.dayOffset - b.dayOffset;
}

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
