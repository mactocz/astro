import { excusedWeekdays } from "@/lib/services/absence";
import { sortAssignments, summarizeCoverage } from "@/lib/services/assignment";
import { holidaysInWeek } from "@/lib/services/calendar";
import { anchorKey, evaluateSchedule, type RuleInput } from "@/lib/services/rules";
import { compareText } from "@/lib/services/schedule";
import { shiftDurationMinutes } from "@/lib/services/shift";
import { weeklyNormExcused, workedMinutesByEmployee, type WeeklyNorm } from "@/lib/services/work-hours";
import type { AbsenceOption, AssignmentInput, GenerationResult, Violation, ViolationRule } from "@/types";

// The schedule generator (S-09): a greedy proposal of assignments that fills the shortages of the staffing grid without
// creating a critical violation and spreads the work against the weekly norm of each FTE. It only adds: no existing
// assignment is moved or removed, no cell goes above its required count, and it never goes back on a choice, so the result
// is not claimed to be the best one. There is no randomness. Whether a person may take a cell is answered by the live rules
// themselves, run for that one person, so the work-time law has no second implementation here.
//
// A candidate (a person and a cell) has a tier: 0 clean, 1 above the weekly norm, 2 on a requested absence, 3 both. The
// generator runs four passes, tier by tier. In pass `t` it repeats while it can: take the cell with a shortage that has the
// fewest candidates of tier `t` or lower to spare over its shortage (tie: day, start of the shift, shift id), and give it
// the candidate with the lowest tier, then the lowest use of the norm, then the fewest minutes, then the lowest id.

export type GeneratorInput = RuleInput & {
  /** The roster of the schedule: the only people the generator assigns. */
  employeeIds: readonly string[];
};

// A person with one of these gets nothing more, whether the addition would create it or it is there already. More work only
// deepens the limits of the week, and the daily rule skips the windows that open inside a reported one, so next to an
// existing `daily_hours` a new breach could show no finding at all.
const BLOCKING_RULES: ReadonlySet<ViolationRule> = new Set<ViolationRule>([
  "daily_hours",
  "weekly_hours",
  "weekly_rest",
]);

const LAST_TIER = 3;

// What the generator knows of a person who may take a cell.
interface Verdict {
  tier: number;
  overNorm: boolean;
  onRequestedAbsence: boolean;
}

// What the rules say about a person as they stand now.
interface Standing {
  blocked: boolean;
  criticalKeys: ReadonlySet<string>;
}

interface Person {
  employee: RuleInput["employees"][number];
  absences: readonly AbsenceOption[];
  norm: WeeklyNorm;
  /** The existing assignments and the additions so far. */
  assignments: AssignmentInput[];
  workedMinutes: number;
  /** Counted when first needed and thrown away when the person gets an assignment, as `verdicts` is. */
  standing: Standing | undefined;
  /** By cell key; null for a cell the person may not take. */
  verdicts: Map<string, Verdict | null>;
}

interface OpenCell {
  key: string;
  shiftId: string;
  dayOffset: number;
  startMinute: number;
  duration: number;
  missing: number;
}

interface Candidate {
  person: Person;
  verdict: Verdict;
}

const cellKey = ({ shiftId, dayOffset }: Pick<AssignmentInput, "shiftId" | "dayOffset">): string =>
  `${dayOffset}:${shiftId}`;

// The rules on one person only: no staffing grid, their assignments and their absences.
function evaluatePerson(input: GeneratorInput, person: Person, assignments: readonly AssignmentInput[]): Violation[] {
  return evaluateSchedule({
    startDate: input.startDate,
    staffing: [],
    assignments,
    shifts: input.shifts,
    employees: [person.employee],
    absences: person.absences,
  });
}

function standingOf(input: GeneratorInput, person: Person): Standing {
  const critical = evaluatePerson(input, person, person.assignments).filter(({ severity }) => severity === "critical");
  return {
    blocked: critical.some(({ rule }) => BLOCKING_RULES.has(rule)),
    criticalKeys: new Set(critical.map(({ key }) => key)),
  };
}

// May the person take the cell, and at what tier. Not when they are on it already, when they are blocked, or when the week
// with the assignment has a critical finding that is new, sits on the new assignment or is one of the blocking rules.
// `standing` is asked before the week with the assignment: an addition can make an existing `weekly_rest` disappear (it
// turns the free time across the edge of the week, which needs 35 h, into a break after a change of shift, which needs 24).
function judge(input: GeneratorInput, person: Person, cell: OpenCell): Verdict | null {
  if (person.assignments.some((assignment) => cellKey(assignment) === cell.key)) {
    return null;
  }
  const standing = (person.standing ??= standingOf(input, person));
  if (standing.blocked) {
    return null;
  }
  const added = { shiftId: cell.shiftId, dayOffset: cell.dayOffset, employeeId: person.employee.id };
  const after = evaluatePerson(input, person, [...person.assignments, added]);
  const addedKey = anchorKey(added);
  const onAddition = ({ anchors }: Violation): boolean => anchors.some((anchor) => anchorKey(anchor) === addedKey);
  const forbidden = after.some(
    (violation) =>
      violation.severity === "critical" &&
      (BLOCKING_RULES.has(violation.rule) || !standing.criticalKeys.has(violation.key) || onAddition(violation)),
  );
  if (forbidden) {
    return null;
  }
  const onRequestedAbsence = after.some((violation) => violation.rule === "absence_requested" && onAddition(violation));
  const overNorm = after.some(({ rule }) => rule === "weekly_norm");
  return { tier: (onRequestedAbsence ? 2 : 0) + (overNorm ? 1 : 0), overNorm, onRequestedAbsence };
}

// The people who may take the cell at `maxTier` or lower.
function candidatesFor(input: GeneratorInput, people: readonly Person[], cell: OpenCell, maxTier: number): Candidate[] {
  const candidates: Candidate[] = [];
  for (const person of people) {
    let verdict = person.verdicts.get(cell.key);
    if (verdict === undefined) {
      verdict = judge(input, person, cell);
      person.verdicts.set(cell.key, verdict);
    }
    if (verdict !== null && verdict.tier <= maxTier) {
      candidates.push({ person, verdict });
    }
  }
  return candidates;
}

// The use of the norm, worked / (base × numerator / denominator), compared exactly in whole numbers. A norm of 0 goes last.
function compareUse(a: Person, b: Person): number {
  const normA = a.norm.baseMinutes * a.norm.fte.numerator;
  const normB = b.norm.baseMinutes * b.norm.fte.numerator;
  if (normA === 0 || normB === 0) {
    return Number(normA === 0) - Number(normB === 0);
  }
  return a.workedMinutes * a.norm.fte.denominator * normB - b.workedMinutes * b.norm.fte.denominator * normA;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.verdict.tier - b.verdict.tier ||
    compareUse(a.person, b.person) ||
    a.person.workedMinutes - b.person.workedMinutes ||
    compareText(a.person.employee.id, b.person.employee.id)
  );
}

// The next assignment of pass `maxTier`, or undefined when no cell with a shortage has a candidate. `cells` come in the
// order that breaks a tie.
function nextChoice(
  input: GeneratorInput,
  people: readonly Person[],
  cells: readonly OpenCell[],
  maxTier: number,
): { cell: OpenCell; candidate: Candidate } | undefined {
  let choice: { cell: OpenCell; candidate: Candidate; spare: number } | undefined;
  for (const cell of cells) {
    if (cell.missing === 0) {
      continue;
    }
    const candidates = candidatesFor(input, people, cell, maxTier);
    if (candidates.length === 0) {
      continue;
    }
    const spare = candidates.length - cell.missing;
    if (choice === undefined || spare < choice.spare) {
      choice = { cell, spare, candidate: candidates.sort(compareCandidates)[0] };
    }
  }
  return choice;
}

// The roster as people to assign, by id. A person of the roster who is not in `employees` has no FTE to weigh, so they are
// left out.
function rosterOf(input: GeneratorInput): Person[] {
  const employees = new Map(
    input.employees.map((employee): [string, RuleInput["employees"][number]] => [employee.id, employee]),
  );
  const worked = new Map(Object.entries(workedMinutesByEmployee(input.assignments, input.shifts)));
  const holidays = holidaysInWeek(input.startDate);
  return [...new Set(input.employeeIds)].sort(compareText).flatMap((id): Person[] => {
    const employee = employees.get(id);
    if (employee === undefined) {
      return [];
    }
    const absences = (input.absences ?? []).filter(({ employeeId }) => employeeId === id);
    return [
      {
        employee,
        absences,
        norm: weeklyNormExcused(holidays, excusedWeekdays(input.startDate, absences, holidays), employee.fte),
        assignments: input.assignments.filter(({ employeeId }) => employeeId === id),
        workedMinutes: worked.get(id) ?? 0,
        standing: undefined,
        verdicts: new Map(),
      },
    ];
  });
}

/**
 * The assignments to add to a schedule so that its shortages are filled as far as the rules allow. Only people of
 * `employeeIds`, only cells of the staffing grid with a shortage, never above the required count and only shifts of
 * `shifts` (a cell of another shift stays short). No addition creates a critical violation, and a person who has
 * `daily_hours`, `weekly_hours` or `weekly_rest` gets nothing. The input is only read and its order does not matter. Throws
 * a RangeError where the rules do (a `startDate` or an FTE they reject).
 */
export function generateSchedule(input: GeneratorInput): GenerationResult {
  const shiftsById = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const coverage = summarizeCoverage(input.staffing, input.assignments);
  const cells = coverage
    .flatMap(({ shiftId, dayOffset, missing }): OpenCell[] => {
      const shift = shiftsById.get(shiftId);
      if (shift === undefined || missing === 0) {
        return [];
      }
      const key = cellKey({ shiftId, dayOffset });
      const duration = shiftDurationMinutes(shift);
      return [{ key, shiftId, dayOffset, startMinute: shift.startMinute, duration, missing }];
    })
    .sort((a, b) => a.dayOffset - b.dayOffset || a.startMinute - b.startMinute || compareText(a.shiftId, b.shiftId));
  const people = rosterOf(input);

  const additions: AssignmentInput[] = [];
  const onRequestedAbsence: AssignmentInput[] = [];
  const overNorm = new Set<string>();
  for (let tier = 0; tier <= LAST_TIER; tier++) {
    let choice = nextChoice(input, people, cells, tier);
    while (choice !== undefined) {
      const { cell, candidate } = choice;
      const { person, verdict } = candidate;
      const added = { shiftId: cell.shiftId, dayOffset: cell.dayOffset, employeeId: person.employee.id };
      additions.push(added);
      if (verdict.onRequestedAbsence) {
        onRequestedAbsence.push(added);
      }
      if (verdict.overNorm) {
        overNorm.add(person.employee.id);
      }
      cell.missing -= 1;
      person.assignments.push(added);
      person.workedMinutes += cell.duration;
      // Only what is known about this person has changed.
      person.standing = undefined;
      person.verdicts.clear();
      choice = nextChoice(input, people, cells, tier);
    }
  }

  return {
    additions: sortAssignments(additions),
    // Every addition is a person who was not on the cell, so each one takes one off the shortage.
    missing: coverage.reduce((sum, cell) => sum + cell.missing, 0) - additions.length,
    overNormEmployeeIds: [...overNorm].sort(compareText),
    onRequestedAbsence: sortAssignments(onRequestedAbsence),
  };
}

/**
 * The Polish sentences that tell the planner what a generation did, one per item of the list. With additions: how many were
 * added, how many people are still missing (or that the staffing is complete) and, only when there are any, how many people
 * are above their norm and how many additions fall on a requested absence. With none: that the staffing is full already, or
 * that nobody can be added and how many are missing.
 */
export function formatGenerationSummary({
  additions,
  missing,
  overNormEmployeeIds,
  onRequestedAbsence,
}: GenerationResult): string[] {
  if (additions.length === 0) {
    return missing === 0
      ? ["Obsada jest już pełna, nie ma czego dodać."]
      : [
          "Nie można nikogo dodać: nikt z grafiku nie może objąć brakujących zmian bez krytycznego naruszenia.",
          `Brakuje osób: ${missing}.`,
        ];
  }
  const sentences = [
    `Dodane przypisania: ${additions.length}.`,
    missing === 0 ? "Obsada jest pełna." : `Nadal brakuje osób: ${missing}.`,
  ];
  if (overNormEmployeeIds.length > 0) {
    sentences.push(`Osoby z dodanymi zmianami ponad normę tygodniową: ${overNormEmployeeIds.length}.`);
  }
  if (onRequestedAbsence.length > 0) {
    sentences.push(`Przypisania mimo niezatwierdzonego wniosku o nieobecność: ${onRequestedAbsence.length}.`);
  }
  return sentences;
}
