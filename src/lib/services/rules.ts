import {
  absenceInterval,
  absenceTypeLabel,
  excusedWeekdays,
  formatAbsenceRange,
  rangesOverlap,
} from "@/lib/services/absence";
import { summarizeCoverage } from "@/lib/services/assignment";
import { holidaysInWeek } from "@/lib/services/calendar";
import { formatFteLabel } from "@/lib/services/fte";
import { PERIOD_DAYS, compareText, dayColumns, formatPeriod } from "@/lib/services/schedule";
import { MINUTES_PER_DAY, formatDuration, formatShiftTimes, formatTime } from "@/lib/services/shift";
import {
  exceedsNorm,
  normMinutes,
  shiftInterval,
  weeklyNormExcused,
  workedMinutesByEmployee,
  type ShiftTimes,
} from "@/lib/services/work-hours";
import type {
  AbsenceOption,
  AbsenceType,
  AssignmentInput,
  Fte,
  StaffingCell,
  Violation,
  ViolationAnchor,
  ViolationCounts,
  ViolationRule,
  ViolationSeverity,
} from "@/types";

// The work-time rules of the live check (S-05). Critical: rest between shifts, hours in a day, hours in a week and the weekly
// rest. Warnings: the hours of a week against the norm of the FTE and a shortage of staff on a cell of the staffing grid.
// Pure functions on whole minutes, with no time zone in them: a shift is an interval on the timeline of one person,
// counted in minutes from midnight of the first day of the schedule. The rules judge one schedule only, so the rest on
// either side of it (the previous and the next week) is not checked. `evaluateSchedule` is the one entry point that puts
// all of them together.
//
// The absences of S-07 add two rules: a shift that overlaps an approved absence is critical (`absence`), one that overlaps
// only a requested absence is a warning (`absence_requested`), and an approved absence lowers the weekly norm. An absence
// is an interval on the same timeline (whole days, `absenceInterval`), so a night shift that runs into the first day of an
// absence collides with it.

/** The least rest between two shifts of a person (art. 132): 11 h, the limit itself is allowed. */
export const DAILY_REST_MINUTES = 660;
/** The most work in a day (art. 129): 8 h, the limit itself is allowed. */
export const DAILY_HOURS_MINUTES = 480;
/** The day of art. 128 § 3: the 24 hours counted from the moment a shift starts, not the calendar day. */
export const DAY_WINDOW_MINUTES = MINUTES_PER_DAY;
/** The most work in the seven days of a schedule (art. 131): 48 h, the limit itself is allowed. */
export const WEEKLY_HOURS_MINUTES = 2880;
/** The least weekly rest (art. 133 § 1): 35 h, the limit itself is allowed. */
export const WEEKLY_REST_MINUTES = 2100;
/** The least weekly rest after a change of shift (art. 133 § 2): 24 h, when the shifts around it start at other times. */
export const WEEKLY_REST_SHIFT_CHANGE_MINUTES = 1440;
/** The seven days of a schedule in minutes. */
export const WEEK_MINUTES = PERIOD_DAYS * MINUTES_PER_DAY;

/**
 * The place of each rule in the order a result lists them, the lowest first. A table with a key for every rule, so that a
 * rule added to `ViolationRule` and left out here does not compile (it would sort before all the others otherwise).
 */
export const RULE_RANK = {
  daily_rest: 0,
  daily_hours: 1,
  weekly_hours: 2,
  weekly_rest: 3,
  absence: 4,
  weekly_norm: 5,
  understaffed: 6,
  absence_requested: 7,
} as const satisfies Record<ViolationRule, number>;

// The same for the severity: critical first.
const SEVERITY_RANK = { critical: 0, warning: 1 } as const satisfies Record<ViolationSeverity, number>;

// What stands in a key and in an anchor for "no employee".
const NO_EMPLOYEE = "-";

const LONG_SHIFT_NOTE = `Zmiana dłuższa niż ${formatDuration(DAILY_HOURS_MINUTES)} wymaga systemu równoważnego czasu pracy (art. 135), którego Shiftly nie obsługuje.`;

/**
 * What the rules read: the first day of the schedule, its staffing grid, the assignments, the hours of the shifts and the
 * employees (name and FTE). The arrays are only read. An assignment to a shift that is not in `shifts` has no hours, so the
 * time rules leave it out; an employee that is not in `employees` is shown by id and, having no FTE, is left out of the
 * weekly norm. The staffing grid has one cell per shift and day. `startDate` must be a date that `parseIsoDate` accepts and
 * an FTE a fraction that `weeklyNorm` accepts: the rules throw a RangeError for another.
 *
 * `absences` (S-07) is optional, so that an input without it is judged as before. A rejected absence is ignored, a requested
 * one only warns and an approved one is critical and lowers the weekly norm; the dates of an absence must be ones that
 * `parseIsoDate` accepts (a RangeError otherwise). An absence of a person who has no shift in the schedule changes nothing,
 * and the same absence listed twice is judged as one.
 */
export interface RuleInput {
  /** The first day as `YYYY-MM-DD`. */
  startDate: string;
  staffing: readonly StaffingCell[];
  assignments: readonly AssignmentInput[];
  shifts: readonly ShiftTimes[];
  employees: readonly { id: string; name: string; fte: Fte }[];
  absences?: readonly AbsenceOption[];
}

/** The key of one anchor, `<day offset>:<shift id>:<employee id or ->`. */
export function anchorKey({ dayOffset, shiftId, employeeId }: ViolationAnchor): string {
  return `${dayOffset}:${shiftId}:${employeeId ?? NO_EMPLOYEE}`;
}

/**
 * The key of a violation: `<rule>|<employee id or ->|<anchor keys>`, the anchor keys in code-unit order and joined with
 * commas. It holds ids and the day offset of an anchor only, no number computed from the data, no index and no time, so
 * the same finding has the same key whatever the order of the input or the hours of the shifts. `keyAnchors` are the
 * anchors that identify the finding: all of its anchors, except for `daily_hours`, which is identified by the assignment
 * that opens its window (see `dailyHours`).
 */
export function violationKey(
  rule: ViolationRule,
  employeeId: string | null,
  keyAnchors: readonly ViolationAnchor[],
): string {
  const keys = keyAnchors.map((anchor) => anchorKey(anchor)).sort(compareText);
  return `${rule}|${employeeId ?? NO_EMPLOYEE}|${keys.join(",")}`;
}

// A person (an id) before no person: only a staffing cell has none.
function compareEmployees(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  return b === null ? -1 : compareText(a, b);
}

/**
 * The canonical order of violations: the severity (critical first), the rule (`RULE_RANK`), the employee (by id, a cell
 * without one last), then the key. Plain code-unit order for the text, never a collator, so that the same findings come in
 * the same order whatever the locale and the order of the input.
 */
export function compareViolations(a: Violation, b: Violation): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    RULE_RANK[a.rule] - RULE_RANK[b.rule] ||
    compareEmployees(a.employeeId, b.employeeId) ||
    compareText(a.key, b.key)
  );
}

// One assignment as an interval on the timeline of its person.
interface Segment {
  shift: ShiftTimes;
  dayOffset: number;
  employeeId: string;
  /** Minutes from midnight of day 0. */
  start: number;
  /** Minutes from midnight of day 0; past the last day for a night shift that starts on day 6 (see `shiftInterval`). */
  end: number;
  duration: number;
}

interface Timeline {
  employeeId: string;
  /** Sorted by start, end and shift id. Never empty. */
  segments: Segment[];
}

// One absence as an interval on the same timeline: whole days from midnight of its first day to the end of its last one.
interface AbsenceSpan {
  absence: AbsenceOption;
  /** Minutes from midnight of day 0; below 0 for an absence that began before the schedule. */
  start: number;
  /** Minutes from midnight of day 0, exclusive; past the last day for an absence that goes on after the schedule. */
  end: number;
}

interface Context {
  period: string;
  /** The people with at least one shift that has hours, sorted by id. */
  timelines: Timeline[];
  /**
   * The requested and the approved absences of each person (a rejected one is left out), the strongest first (see
   * `compareAbsenceSpans`). A person with none has no entry.
   */
  absences: ReadonlyMap<string, readonly AbsenceSpan[]>;
  nameOf: (employeeId: string) => string;
  dayLabel: (dayOffset: number) => string;
  /** "Poranna (pon. 02.11, 06:00–14:00)". */
  describe: (segment: Segment) => string;
  /** The same for a shift id and a day; a shift that has no hours is shown by its id, with the day only. */
  describeCell: (shiftId: string, dayOffset: number) => string;
}

const anchorOf = ({ shift, dayOffset, employeeId }: Segment): ViolationAnchor => ({
  shiftId: shift.id,
  dayOffset,
  employeeId,
});

function compareSegments(a: Segment, b: Segment): number {
  return a.start - b.start || a.end - b.end || compareText(a.shift.id, b.shift.id);
}

// The strongest absence first: an approved one before a requested one, then the one that starts earlier, then the one that
// lasts longer, then by type. The first of a person's absences that a shift overlaps is the one the reason names, so the
// order has to tell apart everything the reason shows (the weight, the days and the type), and then the same finding reads
// the same whatever the order of the input.
function compareAbsenceSpans(a: AbsenceSpan, b: AbsenceSpan): number {
  return (
    Number(a.absence.status !== "approved") - Number(b.absence.status !== "approved") ||
    a.start - b.start ||
    b.end - a.end ||
    compareText(a.absence.type, b.absence.type)
  );
}

// The absences of every person as intervals, a rejected one left out.
function absencesByEmployee(startDate: string, absences: readonly AbsenceOption[]): Map<string, AbsenceSpan[]> {
  const byEmployee = new Map<string, AbsenceSpan[]>();
  for (const absence of absences) {
    if (absence.status === "rejected") {
      continue;
    }
    const span: AbsenceSpan = { absence, ...absenceInterval(startDate, absence) };
    const spans = byEmployee.get(absence.employeeId);
    if (spans === undefined) {
      byEmployee.set(absence.employeeId, [span]);
    } else {
      spans.push(span);
    }
  }
  for (const spans of byEmployee.values()) {
    spans.sort(compareAbsenceSpans);
  }
  return byEmployee;
}

// The timeline of every person, built once for all the rules. The same assignment twice counts once, as in
// `workedMinutesByEmployee`.
function prepare(input: RuleInput): Context {
  const shiftsById = new Map(input.shifts.map((shift): [string, ShiftTimes] => [shift.id, shift]));
  const names = new Map(input.employees.map(({ id, name }): [string, string] => [id, name]));
  const labels = new Map(dayColumns(input.startDate).map(({ offset, label }): [number, string] => [offset, label]));
  const dayLabel = (dayOffset: number): string => labels.get(dayOffset) ?? `dzień ${dayOffset}`;
  const describeShift = (shift: ShiftTimes, dayOffset: number): string =>
    `${shift.name} (${dayLabel(dayOffset)}, ${formatShiftTimes(shift)})`;

  const seen = new Set<string>();
  const byEmployee = new Map<string, Segment[]>();
  for (const { shiftId, dayOffset, employeeId } of input.assignments) {
    const shift = shiftsById.get(shiftId);
    const key = anchorKey({ shiftId, dayOffset, employeeId });
    if (shift === undefined || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const { start, end } = shiftInterval(shift, dayOffset);
    const segment: Segment = { shift, dayOffset, employeeId, start, end, duration: end - start };
    const segments = byEmployee.get(employeeId);
    if (segments === undefined) {
      byEmployee.set(employeeId, [segment]);
    } else {
      segments.push(segment);
    }
  }

  return {
    period: formatPeriod(input.startDate),
    timelines: [...byEmployee]
      .sort(([a], [b]) => compareText(a, b))
      .map(([employeeId, segments]) => ({ employeeId, segments: segments.sort(compareSegments) })),
    absences: absencesByEmployee(input.startDate, input.absences ?? []),
    nameOf: (employeeId) => names.get(employeeId) ?? employeeId,
    dayLabel,
    describe: ({ shift, dayOffset }) => describeShift(shift, dayOffset),
    describeCell: (shiftId, dayOffset) => {
      const shift = shiftsById.get(shiftId);
      return shift === undefined ? `${shiftId} (${dayLabel(dayOffset)})` : describeShift(shift, dayOffset);
    },
  };
}

// A violation. The anchors are sorted, so the same finding always has the same list and key. The key is made of `keyAnchors`,
// which are the anchors unless the finding is identified by fewer of them than it reaches.
function violationOf(
  severity: ViolationSeverity,
  rule: ViolationRule,
  employeeId: string | null,
  anchors: readonly ViolationAnchor[],
  reason: string,
  actual: number,
  limit: number,
  unit: Violation["unit"],
  keyAnchors: readonly ViolationAnchor[] = anchors,
): Violation {
  const sorted = [...anchors].sort((a, b) => compareText(anchorKey(a), anchorKey(b)));
  return {
    key: violationKey(rule, employeeId, keyAnchors),
    severity,
    rule,
    employeeId,
    anchors: sorted,
    reason,
    actual,
    limit,
    unit,
  };
}

// A critical violation in minutes, about one person.
function criticalViolation(
  rule: ViolationRule,
  employeeId: string,
  anchors: readonly ViolationAnchor[],
  reason: string,
  actual: number,
  limit: number,
  keyAnchors: readonly ViolationAnchor[] = anchors,
): Violation {
  return violationOf("critical", rule, employeeId, anchors, reason, actual, limit, "minutes", keyAnchors);
}

function dailyRest({ timelines, nameOf, describe }: Context): Violation[] {
  const violations: Violation[] = [];
  for (const { employeeId, segments } of timelines) {
    // The shift that ends last of the ones before the current one: a long shift can hold a shorter one inside it, and the
    // rest counts from the end of the long one.
    let earlier: Segment | undefined;
    for (const next of segments) {
      if (earlier !== undefined) {
        const gap = next.start - earlier.end;
        if (gap < DAILY_REST_MINUTES) {
          const name = nameOf(employeeId);
          const required = formatDuration(DAILY_REST_MINUTES);
          const reason =
            gap < 0
              ? `${name}: zmiany ${describe(earlier)} i ${describe(next)} nakładają się o ${formatDuration(Math.min(earlier.end, next.end) - next.start)}, wymagana przerwa co najmniej ${required}.`
              : `${name}: przerwa ${formatDuration(gap)} między zmianami ${describe(earlier)} i ${describe(next)}, wymagane co najmniej ${required}.`;
          violations.push(
            criticalViolation(
              "daily_rest",
              employeeId,
              [anchorOf(earlier), anchorOf(next)],
              reason,
              Math.max(gap, 0),
              DAILY_REST_MINUTES,
            ),
          );
        }
      }
      if (earlier === undefined || next.end > earlier.end) {
        earlier = next;
      }
    }
  }
  return violations.sort(compareViolations);
}

// The window of a day opens at the start of each shift and lasts 24 hours. The work in it is what the person actually works
// there: a shift from the day before that reaches into the window counts for the part inside it, and the shifts add up
// (two shifts that overlap are two shifts of work, and are reported as an overlap by the rest rule). The anchors are all the
// assignments that reach into the window, but the key is made of the one that opens it: the same finding keeps its key when
// another shift is added to the window.
function dailyHours({ timelines, nameOf, dayLabel }: Context): Violation[] {
  const violations: Violation[] = [];
  for (const { employeeId, segments } of timelines) {
    // The end of the last window reported for this person. A window that opens inside it belongs to the same group of
    // overlapping windows and is not reported again.
    let reportedUntil = Number.NEGATIVE_INFINITY;
    for (const origin of segments) {
      if (origin.start < reportedUntil) {
        continue;
      }
      const windowEnd = origin.start + DAY_WINDOW_MINUTES;
      const inWindow: Segment[] = [];
      let worked = 0;
      for (const segment of segments) {
        const minutes = Math.min(segment.end, windowEnd) - Math.max(segment.start, origin.start);
        if (minutes > 0) {
          inWindow.push(segment);
          worked += minutes;
        }
      }
      if (worked <= DAILY_HOURS_MINUTES) {
        continue;
      }
      reportedUntil = windowEnd;
      const opening = `${dayLabel(origin.dayOffset)}, ${formatTime(origin.shift.startMinute)}`;
      const note = inWindow.some(({ duration }) => duration > DAILY_HOURS_MINUTES) ? ` ${LONG_SHIFT_NOTE}` : "";
      violations.push(
        criticalViolation(
          "daily_hours",
          employeeId,
          inWindow.map(anchorOf),
          `${nameOf(employeeId)}: w dobie liczonej od ${opening} przepracowane ${formatDuration(worked)}, dopuszczalne najwyżej ${formatDuration(DAILY_HOURS_MINUTES)}.${note}`,
          worked,
          DAILY_HOURS_MINUTES,
          [anchorOf(origin)],
        ),
      );
    }
  }
  return violations.sort(compareViolations);
}

function weeklyHours({ timelines, nameOf, period }: Context): Violation[] {
  const violations: Violation[] = [];
  for (const { employeeId, segments } of timelines) {
    const total = segments.reduce((sum, { duration }) => sum + duration, 0);
    if (total > WEEKLY_HOURS_MINUTES) {
      violations.push(
        criticalViolation(
          "weekly_hours",
          employeeId,
          [],
          `${nameOf(employeeId)}: w tygodniu grafiku (${period}) łączny czas pracy ${formatDuration(total)}, dopuszczalne najwyżej ${formatDuration(WEEKLY_HOURS_MINUTES)}.`,
          total,
          WEEKLY_HOURS_MINUTES,
        ),
      );
    }
  }
  return violations.sort(compareViolations);
}

// A break in the work of a person, in minutes from midnight of day 0, and the length it has to reach to be a weekly rest.
// A break across the edge of the schedule (from the last shift to the first one of the next round) has an `end` past
// `WEEK_MINUTES`: the part past it is the time from the start of the schedule to the first shift.
interface Gap {
  start: number;
  end: number;
  limit: number;
}

const gapLength = ({ start, end }: Gap): number => end - start;

// The breaks of the seven days. The schedule is judged alone, and a person's free time at its edges is assumed to repeat
// in the week before and after it (cyclic): the time from the last shift to the end of the schedule and the time from its
// start to the first shift are ONE break across the edge, with no shift on the far side to compare, so it needs the full
// 35 h. When only one of the two exists (a shift that starts at midnight of day 0, or one that ends at or past the end of
// the schedule) that one stands as it is. A break between two shifts needs 24 h when they start at different times of the
// day (the change of shift). The break across the edge comes first, so that it is the one named when it ties with another.
function restGaps(segments: readonly Segment[]): Gap[] {
  const inner: Gap[] = [];
  let earlier = segments[0];
  const head = earlier.start;
  for (const next of segments.slice(1)) {
    if (next.start > earlier.end) {
      const changed = next.shift.startMinute !== earlier.shift.startMinute;
      inner.push({
        start: earlier.end,
        end: next.start,
        limit: changed ? WEEKLY_REST_SHIFT_CHANGE_MINUTES : WEEKLY_REST_MINUTES,
      });
    }
    if (next.end > earlier.end) {
      earlier = next;
    }
  }
  const tail = Math.max(WEEK_MINUTES - earlier.end, 0);

  const gaps: Gap[] = [];
  if (head > 0 && tail > 0) {
    gaps.push({ start: earlier.end, end: WEEK_MINUTES + head, limit: WEEKLY_REST_MINUTES });
  } else if (head > 0) {
    gaps.push({ start: 0, end: head, limit: WEEKLY_REST_MINUTES });
  } else if (tail > 0) {
    gaps.push({ start: earlier.end, end: WEEK_MINUTES, limit: WEEKLY_REST_MINUTES });
  }
  return [...gaps, ...inner];
}

// The longest break, the first of the list when two are equally long.
function longestGap(gaps: readonly Gap[]): Gap | undefined {
  let longest: Gap | undefined;
  for (const gap of gaps) {
    if (longest === undefined || gapLength(gap) > gapLength(longest)) {
      longest = gap;
    }
  }
  return longest;
}

function weeklyRest({ timelines, nameOf, dayLabel, period }: Context): Violation[] {
  const moment = (minute: number): string =>
    `${dayLabel(Math.floor(minute / MINUTES_PER_DAY))}, ${formatTime(minute % MINUTES_PER_DAY)}`;
  const where = ({ start, end }: Gap): string =>
    end > WEEK_MINUTES
      ? `od ${moment(start)} do końca grafiku i od początku grafiku do ${moment(end - WEEK_MINUTES)}`
      : `od ${start === 0 ? "początku grafiku" : moment(start)} do ${end === WEEK_MINUTES ? "końca grafiku" : moment(end)}`;

  const violations: Violation[] = [];
  for (const { employeeId, segments } of timelines) {
    const gaps = restGaps(segments);
    if (gaps.some((gap) => gapLength(gap) >= gap.limit)) {
      continue;
    }
    const longest = longestGap(gaps);
    const limit = longest?.limit ?? WEEKLY_REST_MINUTES;
    const required = `wymagany odpoczynek tygodniowy co najmniej ${formatDuration(limit)}`;
    const shortened =
      limit === WEEKLY_REST_SHIFT_CHANGE_MINUTES
        ? ` (skrócony z ${formatDuration(WEEKLY_REST_MINUTES)} przy przejściu na inną zmianę, bo zmiany przed przerwą i po niej zaczynają się o innej godzinie)`
        : "";
    const head = `${nameOf(employeeId)}: w tygodniu grafiku (${period})`;
    violations.push(
      criticalViolation(
        "weekly_rest",
        employeeId,
        [],
        longest === undefined
          ? `${head} nie ma żadnej przerwy, ${required}.`
          : `${head} najdłuższa przerwa trwa ${formatDuration(gapLength(longest))} (${where(longest)}), ${required}${shortened}.`,
        longest === undefined ? 0 : gapLength(longest),
        limit,
      ),
    );
  }
  return violations.sort(compareViolations);
}

// "święto 11.11", "święta 11.11 i 12.11" or "święta 24.12, 25.12 i 26.12": the dates of the holidays of a week (never more
// than seven days apart, so with no year).
function formatHolidays(holidays: readonly string[]): string {
  const dates = holidays.map(dayAndMonth);
  const last = dates[dates.length - 1];
  const list = dates.length === 1 ? last : `${dates.slice(0, -1).join(", ")} i ${last}`;
  return `${dates.length === 1 ? "święto" : "święta"} ${list}`;
}

// "02.11" for "2026-11-02": the day and the month of a date of the week of a schedule (no year, as the days are never more
// than seven days apart).
function dayAndMonth(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

// "nieobecność (1 dzień: 02.11)" or "nieobecność (3 dni: 02.11, 03.11, 05.11)": the days of Monday to Friday that an approved
// absence took off the norm. There are one to five of them, so only "dzień" and "dni" occur.
function formatExcusedDays(excusedDays: readonly string[]): string {
  const count = excusedDays.length === 1 ? "1 dzień" : `${excusedDays.length} dni`;
  return `nieobecność (${count}: ${excusedDays.map(dayAndMonth).join(", ")})`;
}

// What the norm was lowered by, for the end of "po pomniejszeniu o ...": the holidays, the days of absence or both ("święto
// 11.11 i nieobecność (2 dni: 12.11, 13.11)"). Several holidays end in an "i" of their own, so the absence follows with
// "oraz" and the sentence does not say "i" twice in a row. An empty text when nothing lowered it.
function formatLoweredBy(holidays: readonly string[], excusedDays: readonly string[]): string {
  const parts = [
    ...(holidays.length > 0 ? [formatHolidays(holidays)] : []),
    ...(excusedDays.length > 0 ? [formatExcusedDays(excusedDays)] : []),
  ];
  return parts.length === 0 ? "" : ` po pomniejszeniu o ${parts.join(holidays.length > 1 ? " oraz " : " i ")}`;
}

// The hours of a week against the norm of the FTE. The comparison is exact (`exceedsNorm`), and the limit shown is the norm
// rounded to the minute. When the work equals that rounded limit and still exceeds the exact norm, the reason says so, as the
// two numbers it shows would be equal otherwise. A person who is not in the list of employees has no FTE, so they are
// skipped; one with no hours cannot exceed a norm. The holidays of the week are the same for everybody, so they are looked
// up once. The norm of a person is lowered by the days of their approved absences as well (`excusedWeekdays`, the same
// function that the hours of the people's table take their norm from, so that the two never disagree); it can reach 0, and
// then any work at all exceeds it.
function weeklyNormWarnings(
  { startDate, assignments, shifts, employees }: RuleInput,
  { period, absences }: Context,
): Violation[] {
  const worked = new Map(Object.entries(workedMinutesByEmployee(assignments, shifts)));
  // One entry for each id, so that a repeated employee is judged once.
  const people = new Map(
    employees.map((employee): [string, RuleInput["employees"][number]] => [employee.id, employee]),
  );
  const holidays = holidaysInWeek(startDate);
  const violations: Violation[] = [];
  for (const { id, name, fte } of people.values()) {
    const minutes = worked.get(id);
    if (minutes === undefined) {
      continue;
    }
    const own = absences.get(id)?.map(({ absence }) => absence);
    const excused = own === undefined ? [] : excusedWeekdays(startDate, own, holidays);
    const norm = weeklyNormExcused(holidays, excused, fte);
    if (!exceedsNorm(minutes, norm)) {
      continue;
    }
    const limit = normMinutes(norm);
    const lowered = formatLoweredBy(norm.holidays, norm.excusedDays);
    const fraction = minutes === limit ? " (przekroczona o ułamek minuty)" : "";
    violations.push(
      violationOf(
        "warning",
        "weekly_norm",
        id,
        [],
        `${name}: w tygodniu grafiku (${period}) łączny czas pracy ${formatDuration(minutes)}, norma tygodniowa (${formatFteLabel(norm.fte)}) to ${formatDuration(limit)}${lowered}${fraction}.`,
        minutes,
        limit,
        "minutes",
      ),
    );
  }
  return violations.sort(compareViolations);
}

// One warning for each staffing cell with fewer people assigned than it needs. A surplus is not a violation. A cell of a
// shift that has no hours is judged as well: the headcount needs no hours.
function understaffedWarnings({ staffing, assignments }: RuleInput, { describeCell }: Context): Violation[] {
  return summarizeCoverage(staffing, assignments)
    .filter(({ missing }) => missing > 0)
    .map(({ shiftId, dayOffset, required, assigned, missing }) =>
      violationOf(
        "warning",
        "understaffed",
        null,
        [{ shiftId, dayOffset, employeeId: null }],
        `Brak obsady: zmiana ${describeCell(shiftId, dayOffset)}: przypisano ${assigned} z ${required}, brakuje ${missing}.`,
        assigned,
        required,
        "people",
      ),
    )
    .sort(compareViolations);
}

// The type of an absence after "przypada na": "przypada na urlop".
const ABSENCE_ACCUSATIVE = {
  vacation: "urlop",
  sick_leave: "zwolnienie lekarskie (L4)",
  other: "inną nieobecność",
} as const satisfies Record<AbsenceType, string>;

// "urlop" for "Urlop": a label in the middle of a sentence. Only the first letter is lowered, so the "L4" of a sick leave stays.
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

// One violation for each assignment that overlaps an absence of its person, however many absences it overlaps: the strongest
// one decides the weight and is the one the reason names (`compareAbsenceSpans` puts it first). The anchor is the assignment
// alone, so the key holds the person and the assignment and nothing about the absence. `actual` is how many minutes of the
// shift fall inside that absence. An assignment to a shift that has no hours is not a segment, so it is left out.
function absenceCollisions({ timelines, absences, nameOf, describe }: Context): Violation[] {
  const violations: Violation[] = [];
  for (const { employeeId, segments } of timelines) {
    const own = absences.get(employeeId);
    if (own === undefined) {
      continue;
    }
    for (const segment of segments) {
      const hit = own.find((span) => rangesOverlap(segment, span));
      if (hit === undefined) {
        continue;
      }
      const { absence } = hit;
      const overlap = Math.min(segment.end, hit.end) - Math.max(segment.start, hit.start);
      const range = formatAbsenceRange(absence);
      const head = `${nameOf(employeeId)}: zmiana ${describe(segment)} przypada na`;
      const anchors = [anchorOf(segment)];
      violations.push(
        absence.status === "approved"
          ? criticalViolation(
              "absence",
              employeeId,
              anchors,
              `${head} ${ABSENCE_ACCUSATIVE[absence.type]} (${range}).`,
              overlap,
              0,
            )
          : violationOf(
              "warning",
              "absence_requested",
              employeeId,
              anchors,
              `${head} nieobecność jeszcze niezatwierdzoną (${lowerFirst(absenceTypeLabel(absence.type))}, ${range}).`,
              overlap,
              0,
              "minutes",
            ),
      );
    }
  }
  return violations.sort(compareViolations);
}

/**
 * The daily rest (art. 132): between two shifts of one person, counted from the latest end so far to the next start, at
 * least 11 h (660 minutes; 660 is allowed, 659 is not). A gap below zero is an overlap of the two shifts and has its own
 * reason. The anchors are the two assignments. Critical.
 */
export function dailyRestViolations(input: RuleInput): Violation[] {
  return dailyRest(prepare(input));
}

/**
 * The hours in a day (art. 129 with art. 128 § 3): at most 8 h (480 minutes; 481 is not allowed) of work in the 24 hours
 * from the start of any shift. A window that opens inside one already reported for the person is skipped, so a group of
 * overlapping windows is one violation. The anchors are the assignments that reach into the window, and the key is made of
 * the one that opens it, so that another shift in the same window changes the anchors and not the key. A shift longer than
 * 8 h adds the sentence that the equivalent working-time system (art. 135) is not supported. Critical.
 */
export function dailyHoursViolations(input: RuleInput): Violation[] {
  return dailyHours(prepare(input));
}

/**
 * The hours in the seven days of the schedule (art. 131): the full durations of the shifts that start in it add up to at
 * most 48 h (2880 minutes; 2881 is not allowed), a night shift from the last day included. No anchors. Critical.
 */
export function weeklyHoursViolations(input: RuleInput): Violation[] {
  return weeklyHours(prepare(input));
}

/**
 * The weekly rest (art. 133): a person with shifts needs one break of at least 35 h (2100 minutes) in the seven days of
 * the schedule, or of at least 24 h (1440) when the shifts before and after the break start at different times of the day.
 * The schedule is judged alone and the free time at its edges is assumed to repeat around it: the time from the last
 * shift to the end of the schedule and the time from its start to the first shift are one break across the edge (never
 * the 24 h threshold, there is no shift to compare), so the edges never make a violation by themselves. A person without
 * shifts has no violation. `actual` is the longest break (the one across the edge counted whole) and `limit` the threshold
 * that applies to it. No anchors. Critical.
 */
export function weeklyRestViolations(input: RuleInput): Violation[] {
  return weeklyRest(prepare(input));
}

/**
 * The weekly norm (art. 130, in the form of a week of the schedule): a person on the list of employees whose work in the
 * seven days of the schedule is above 40 h times the FTE, less 8 h times the FTE for each holiday on a day other than Sunday
 * and for each day from Monday to Friday, not a holiday, that an approved absence covers (decision D7 of S-07; the norm is
 * never below 0, and then any work exceeds it), gets a warning. The comparison is exact (3/7 of 40 h is 1028.57 minutes, so
 * 1029 exceeds it and 1028 does not); `limit` is the norm rounded to the minute, and when the work equals it (1029) the
 * reason adds that the norm is exceeded by a fraction of a minute. A person who is not in `employees` is skipped. No
 * anchors. A warning, not a critical violation: the norm of the law is monthly and averaged, so one week above it is not a
 * breach by itself.
 */
export function weeklyNormViolations(input: RuleInput): Violation[] {
  return weeklyNormWarnings(input, prepare(input));
}

/**
 * The absences (S-07): one violation for each assignment whose shift overlaps an absence of its person, on the timeline of
 * minutes (an absence takes whole days, and a night shift that starts the evening before it and runs into its first day
 * overlaps it; a shift that ends exactly at midnight, when the absence starts, does not). Critical (`absence`) when any
 * approved absence overlaps, otherwise a warning (`absence_requested`) when a requested one does; a rejected absence is
 * ignored. With several absences the strongest decides, an approved one before a requested one, then the one that starts
 * earlier. The anchor is the assignment, `actual` the minutes of the shift inside that absence and `limit` 0. An assignment
 * to a shift that is not in `shifts` is skipped, as it has no hours, and so is an input with no `absences`.
 */
export function absenceViolations(input: RuleInput): Violation[] {
  return absenceCollisions(prepare(input));
}

/**
 * The staffing (a shortage of staff): one warning for each cell of the staffing grid with fewer different people assigned
 * than it requires (`summarizeCoverage`). The anchor is the cell (its `employeeId` is null), `actual` the number assigned and
 * `limit` the number required, in people. A cell that is complete or has a surplus gives nothing: a surplus is not a
 * violation.
 */
export function understaffedViolations(input: RuleInput): Violation[] {
  return understaffedWarnings(input, prepare(input));
}

/**
 * Every rule on one schedule: the four critical ones and the two warnings, and the absences with their critical violation
 * and their warning, in one new array in the canonical order (`compareViolations`: critical first, then the rule, the
 * employee and the key). The result does not depend on the order of the input, which is only read, and an input without
 * `absences` gives what it gave before them.
 */
export function evaluateSchedule(input: RuleInput): Violation[] {
  const context = prepare(input);
  return [
    ...dailyRest(context),
    ...dailyHours(context),
    ...weeklyHours(context),
    ...weeklyRest(context),
    ...absenceCollisions(context),
    ...weeklyNormWarnings(input, context),
    ...understaffedWarnings(input, context),
  ].sort(compareViolations);
}

/** How many violations are critical and how many are warnings, for the counter of the view. */
export function summarizeViolations(violations: readonly Violation[]): ViolationCounts {
  return {
    critical: violations.filter(({ severity }) => severity === "critical").length,
    warning: violations.filter(({ severity }) => severity === "warning").length,
  };
}
