import { PERIOD_DAYS, compareText, dayColumns, formatPeriod } from "@/lib/services/schedule";
import { MINUTES_PER_DAY, formatDuration, formatShiftTimes, formatTime } from "@/lib/services/shift";
import { shiftInterval, type ShiftTimes } from "@/lib/services/work-hours";
import type {
  AssignmentInput,
  Fte,
  StaffingCell,
  Violation,
  ViolationAnchor,
  ViolationRule,
  ViolationSeverity,
} from "@/types";

// The critical work-time rules of the live check (S-05): rest between shifts, hours in a day, hours in a week and the weekly
// rest. Pure functions on whole minutes, with no time zone in them: a shift is an interval on the timeline of one person,
// counted in minutes from midnight of the first day of the schedule. The rules judge one schedule only, so the rest on
// either side of it (the previous and the next week) is not checked.

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

/** The rules in the order a result lists them. */
export const RULE_ORDER: readonly ViolationRule[] = [
  "daily_rest",
  "daily_hours",
  "weekly_hours",
  "weekly_rest",
  "weekly_norm",
  "understaffed",
];

const SEVERITY_ORDER: readonly ViolationSeverity[] = ["critical", "warning"];

// What stands in a key and in an anchor for "no employee".
const NO_EMPLOYEE = "-";

const LONG_SHIFT_NOTE = `Zmiana dłuższa niż ${formatDuration(DAILY_HOURS_MINUTES)} wymaga systemu równoważnego czasu pracy (art. 135), którego Shiftly nie obsługuje.`;

/**
 * What the rules read: the first day of the schedule, its staffing grid, the assignments, the hours of the shifts and the
 * employees (name and FTE). The arrays are only read. An assignment to a shift that is not in `shifts` has no hours, so the
 * time rules leave it out; an employee that is not in `employees` is shown by id. `startDate` must be a date that
 * `parseIsoDate` accepts: the rules throw a RangeError for another.
 */
export interface RuleInput {
  /** The first day as `YYYY-MM-DD`. */
  startDate: string;
  staffing: readonly StaffingCell[];
  assignments: readonly AssignmentInput[];
  shifts: readonly ShiftTimes[];
  employees: readonly { id: string; name: string; fte: Fte }[];
}

/** The key of one anchor, `<day offset>:<shift id>:<employee id or ->`. */
export function anchorKey({ dayOffset, shiftId, employeeId }: ViolationAnchor): string {
  return `${dayOffset}:${shiftId}:${employeeId ?? NO_EMPLOYEE}`;
}

/**
 * The key of a violation: `<rule>|<employee id or ->|<anchor keys>`, the anchor keys in code-unit order and joined with
 * commas. It holds ids and the day offset of an anchor only, no number computed from the data, no index and no time, so
 * the same finding has the same key whatever the order of the input or the hours of the shifts.
 */
export function violationKey(
  rule: ViolationRule,
  employeeId: string | null,
  anchors: readonly ViolationAnchor[],
): string {
  const keys = anchors.map((anchor) => anchorKey(anchor)).sort(compareText);
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
 * The canonical order of violations: the severity (critical first), the rule (`RULE_ORDER`), the employee (by id, a cell
 * without one last), then the key. Plain code-unit order for the text, never a collator, so that the same findings come in
 * the same order whatever the locale and the order of the input.
 */
export function compareViolations(a: Violation, b: Violation): number {
  return (
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
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

interface Context {
  period: string;
  /** The people with at least one shift that has hours, sorted by id. */
  timelines: Timeline[];
  nameOf: (employeeId: string) => string;
  dayLabel: (dayOffset: number) => string;
  /** "Poranna (pon. 02.11, 06:00–14:00)". */
  describe: (segment: Segment) => string;
}

const anchorOf = ({ shift, dayOffset, employeeId }: Segment): ViolationAnchor => ({
  shiftId: shift.id,
  dayOffset,
  employeeId,
});

function compareSegments(a: Segment, b: Segment): number {
  return a.start - b.start || a.end - b.end || compareText(a.shift.id, b.shift.id);
}

// The timeline of every person, built once for all the rules. The same assignment twice counts once, as in
// `workedMinutesByEmployee`.
function prepare(input: RuleInput): Context {
  const shiftsById = new Map(input.shifts.map((shift): [string, ShiftTimes] => [shift.id, shift]));
  const names = new Map(input.employees.map(({ id, name }): [string, string] => [id, name]));
  const labels = new Map(dayColumns(input.startDate).map(({ offset, label }): [number, string] => [offset, label]));
  const dayLabel = (dayOffset: number): string => labels.get(dayOffset) ?? `dzień ${dayOffset}`;

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
    nameOf: (employeeId) => names.get(employeeId) ?? employeeId,
    dayLabel,
    describe: ({ shift, dayOffset }) => `${shift.name} (${dayLabel(dayOffset)}, ${formatShiftTimes(shift)})`,
  };
}

// A critical violation in minutes. The anchors are sorted, so the same finding always has the same list and key.
function criticalViolation(
  rule: ViolationRule,
  employeeId: string,
  anchors: readonly ViolationAnchor[],
  reason: string,
  actual: number,
  limit: number,
): Violation {
  const sorted = [...anchors].sort((a, b) => compareText(anchorKey(a), anchorKey(b)));
  return {
    key: violationKey(rule, employeeId, sorted),
    severity: "critical",
    rule,
    employeeId,
    anchors: sorted,
    reason,
    actual,
    limit,
    unit: "minutes",
  };
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
// (two shifts that overlap are two shifts of work, and are reported as an overlap by the rest rule).
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
 * overlapping windows is one violation. The anchors are the assignments that reach into the window. A shift longer than 8 h
 * adds the sentence that the equivalent working-time system (art. 135) is not supported. Critical.
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

/** The four critical rules together, in the canonical order (`compareViolations`). */
export function criticalViolations(input: RuleInput): Violation[] {
  const context = prepare(input);
  return [...dailyRest(context), ...dailyHours(context), ...weeklyHours(context), ...weeklyRest(context)].sort(
    compareViolations,
  );
}
