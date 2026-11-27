export type Role = "planner" | "employee";

/** A part-time fraction (e.g. 3/4); always stored in lowest terms, so 2/4 is 1/2. */
export interface Fte {
  numerator: number;
  denominator: number;
}

export interface EmployeeInput {
  firstName: string;
  lastName: string;
  email: string | null;
  fte: Fte;
}

export interface Employee extends EmployeeInput {
  id: string;
  /** ISO timestamp set by the database. */
  createdAt: string;
  /** The id of the linked Auth account, or null while the employee has none. Only the invitation route writes it. */
  readonly userId: string | null;
  /** ISO timestamp of the latest invitation e-mail (also a password-reset link), or null. Only the invitation route writes it. */
  readonly invitedAt: string | null;
  /** ISO timestamp of the first password set from a link, or null while the account has not been activated. Only `mark_account_active()` writes it. */
  readonly activatedAt: string | null;
}

export type EmployeeField = "firstName" | "lastName" | "email" | "fte";
export type EmployeeFieldErrors = Partial<Record<EmployeeField, string>>;

/** A shift template. The times are minutes after midnight (0 to 1439); an end earlier than the start means the next day. */
export interface ShiftInput {
  name: string;
  startMinute: number;
  endMinute: number;
}

export interface Shift extends ShiftInput {
  id: string;
  /** ISO timestamp set by the database. */
  createdAt: string;
}

export type ShiftField = "name" | "startTime" | "endTime";
export type ShiftFieldErrors = Partial<Record<ShiftField, string>>;

/** The number of people a shift needs on one day of the schedule; a day without a shift has no cell at all. */
export interface StaffingCell {
  /** The id of a shift from the shift dictionary. */
  shiftId: string;
  /** Days after the start date, 0 to 6. */
  dayOffset: number;
  /** Whole people, 1 to 99. */
  requiredCount: number;
}

/** A weekly schedule draft: seven days from `startDate`, the staffing grid and the employees it covers (by id). */
export interface ScheduleInput {
  /** The first day as `YYYY-MM-DD`. */
  startDate: string;
  label: string | null;
  staffing: StaffingCell[];
  employeeIds: string[];
}

export interface Schedule extends ScheduleInput {
  id: string;
  /** ISO timestamp set by the database. */
  createdAt: string;
  status: ScheduleStatus;
  /** ISO timestamp of the approval, or null for a draft. */
  approvedAt: string | null;
}

/** One row of the schedule list. */
export interface ScheduleSummary {
  id: string;
  startDate: string;
  label: string | null;
  /** ISO timestamp set by the database. */
  createdAt: string;
  employeeCount: number;
  /** The sum of the required counts over the whole grid. */
  totalRequired: number;
  status: ScheduleStatus;
  /** ISO timestamp of the approval, or null for a draft. */
  approvedAt: string | null;
}

export type ScheduleField = "startDate" | "label" | "staffing" | "employeeIds";
export type ScheduleFieldErrors = Partial<Record<ScheduleField, string>>;

/** Where a schedule stands: still editable, or approved, which is final and locks it. */
export type ScheduleStatus = "draft" | "approved";

/** A shift as it was when the schedule was approved; a later edit of the dictionary does not change it. */
export interface ApprovalSnapshotShift {
  shiftId: string;
  name: string;
  /** Minutes after midnight (0 to 1439), as in `ShiftInput`. */
  startMinute: number;
  /** Minutes after midnight (0 to 1439), as in `ShiftInput`; an end earlier than the start means the next day. */
  endMinute: number;
}

/** A person of the schedule as they were when it was approved, with the hours counted then. */
export interface ApprovalSnapshotEmployee {
  employeeId: string;
  /** "Last name First name", as in `EmployeeOption`. */
  displayName: string;
  fte: Fte;
  workedMinutes: number;
  normMinutes: number;
}

/** The record of an approval: who, when, the findings frozen as they were and the snapshot of shifts and people. */
export interface ScheduleApproval {
  scheduleId: string;
  /** ISO timestamp set by the database. */
  approvedAt: string;
  approvedByEmail: string;
  violations: Violation[];
  confirmedKeys: string[];
  criticalCount: number;
  warningCount: number;
  shifts: ApprovalSnapshotShift[];
  employees: ApprovalSnapshotEmployee[];
}

/**
 * The data the approval route judged. The database compares it, set by set, with the live rows under a lock, so that
 * nothing is approved that was not checked.
 */
export interface ApprovalInputs {
  startDate: string;
  staffing: StaffingCell[];
  employeeIds: string[];
  assignments: AssignmentInput[];
  /** The shifts of the staffing cells only. */
  shifts: { id: string; name: string; startMinute: number; endMinute: number }[];
  /** The people of the roster only. */
  employees: EmployeeOption[];
  /** The absences of the people of the roster, of every status. */
  absences: AbsenceOption[];
}

/** Why an employee is away: leave, sick leave (L4) or another absence. Only whole days, and no free text (L4 is health data). */
export type AbsenceType = "vacation" | "sick_leave" | "other";

/** Where an absence stands: asked for but not decided, approved or rejected. Only an approved one lowers the weekly norm. */
export type AbsenceStatus = "requested" | "approved" | "rejected";

/** What the planner enters: the person, the kind and the first and last day (both included, `YYYY-MM-DD`). */
export interface AbsenceInput {
  /** The id of an employee. */
  employeeId: string;
  type: AbsenceType;
  /** The first day of the absence as `YYYY-MM-DD`, 2020-01-01 to 2099-12-31. */
  startDate: string;
  /** The last day of the absence as `YYYY-MM-DD`, not before `startDate`, 2020-01-01 to 2099-12-31. */
  endDate: string;
}

export interface Absence extends AbsenceInput {
  id: string;
  /** The planner's session only writes an approved absence; a requested one comes from the leave request flow. */
  status: AbsenceStatus;
  /** ISO timestamp set by the database. */
  createdAt: string;
}

export type AbsenceField = "employeeId" | "type" | "startDate" | "endDate";
export type AbsenceFieldErrors = Partial<Record<AbsenceField, string>>;

/** An absence as the schedule page gives it to the island: no id, no creation time, nothing about the account. */
export interface AbsenceOption {
  employeeId: string;
  type: AbsenceType;
  status: AbsenceStatus;
  startDate: string;
  endDate: string;
}

/** Who put an assignment there: the planner by hand, or the schedule generator. */
export type AssignmentSource = "manual" | "generated";

/** One employee on one shift on one day of a schedule; the cell is the pair of `shiftId` and `dayOffset`. */
export interface AssignmentInput {
  /** The id of a shift from the shift dictionary. */
  shiftId: string;
  /** Days after the start date, 0 to 6. */
  dayOffset: number;
  /** The id of an employee. */
  employeeId: string;
}

export interface Assignment extends AssignmentInput {
  source: AssignmentSource;
}

export type AssignmentField = "shiftId" | "dayOffset" | "employeeId";
export type AssignmentFieldErrors = Partial<Record<AssignmentField, string>>;

/** How well one staffing cell is covered: the people it needs against the people assigned to it. */
export interface CoverageCell {
  shiftId: string;
  dayOffset: number;
  /** The required count of the staffing cell. */
  required: number;
  /** Different employees assigned to the cell. */
  assigned: number;
  /** People still missing, never negative. */
  missing: number;
  /** People above the required count, never negative. */
  surplus: number;
}

/** How serious a violation is: a critical one breaks a work-time rule, a warning only asks the planner to look. */
export type ViolationSeverity = "critical" | "warning";

/** The rules of the live check, in the order a result lists them. */
export type ViolationRule =
  | "daily_rest"
  | "daily_hours"
  | "weekly_hours"
  | "weekly_rest"
  | "absence"
  | "weekly_norm"
  | "understaffed"
  | "absence_requested";

/** Where a violation sits in the schedule: an assignment or, when `employeeId` is null, a staffing cell. */
export interface ViolationAnchor {
  shiftId: string;
  /** Days after the start date, 0 to 6. */
  dayOffset: number;
  employeeId: string | null;
}

/** One finding of the live check: a rule broken or a warning, with its reason for people and the numbers behind it. */
export interface Violation {
  /**
   * Stable identity: `<rule>|<employee id or ->|<anchor keys>`, with no number computed from the data, no index and no
   * time in it, so the same finding has the same key whatever the order of the input. The anchor keys are those of
   * `anchors`, except for `daily_hours`: its key holds the opening assignment of the window only, so another shift that
   * reaches into the same window lengthens `anchors` and leaves the key as it was.
   */
  key: string;
  severity: ViolationSeverity;
  rule: ViolationRule;
  /** The employee the violation is about, or null for a staffing cell. */
  employeeId: string | null;
  /** The assignments (or the staffing cell) behind it, sorted by their keys; empty for a whole week of one person. */
  anchors: ViolationAnchor[];
  /** The reason in Polish, with the numbers, for the planner to read. */
  reason: string;
  /** The measured value, in the `unit`. */
  actual: number;
  /** The limit the value is held against, in the `unit`. */
  limit: number;
  unit: "minutes" | "people";
}

/** How many violations are critical and how many are warnings, for the counter of the view. */
export interface ViolationCounts {
  critical: number;
  warning: number;
}

/** A shift as the schedule pages offer it: the times already formatted, plus the minutes the work-time rules use. */
export interface ShiftOption {
  id: string;
  name: string;
  /** Start and end, e.g. "22:00–06:00". */
  times: string;
  endsNextDay: boolean;
  /** Length of the shift, e.g. "8 h". */
  duration: string;
  /** Minutes after midnight (0 to 1439), as in `ShiftInput`. */
  startMinute: number;
  /** Minutes after midnight (0 to 1439), as in `ShiftInput`; an end earlier than the start means the next day. */
  endMinute: number;
}

/** An employee as the schedule pages offer them: the id, the name to show and the FTE, never the e-mail address. */
export interface EmployeeOption {
  id: string;
  /** "Last name First name", the order of the employee list. */
  name: string;
  fte: Fte;
}

/**
 * The hours of one employee in one schedule against the weekly norm of their FTE, in whole minutes. `normMinutes` is the
 * norm rounded to the minute and `differenceMinutes` is `workedMinutes - normMinutes`, so it is negative below the norm.
 * There is no status or threshold: the warning for exceeding the norm is the work-time rule, not this row.
 */
export interface WorkloadRow {
  employeeId: string;
  workedMinutes: number;
  normMinutes: number;
  differenceMinutes: number;
}

/** The state of the Auth account behind an employee: no account, one that never confirmed its invitation, or an active one. */
export type InviteAccountState = "none" | "pending" | "active";

/** What the invitation route does for an account state: a first invitation, a new link, or a password-reset link. */
export type InviteAction = "invite" | "reinvite" | "reset_password";

/** What the invitation route answers on success; one value per `InviteAction`. */
export type InviteResult = "invited" | "reinvited" | "password_reset";

/**
 * The account as the planner sees it in the employee list: none, invited (the link may still work or may have expired),
 * or active (the employee has set a password). The timestamps are ISO strings (UTC).
 */
export type InviteStatus =
  | { kind: "no_account" }
  | { kind: "invited"; invitedAt: string; validUntil: string; expired: boolean }
  | { kind: "active"; activatedAt: string };

/** One flag per part of the password rule, true when that part is met. */
export interface PasswordCheck {
  minLength: boolean;
  upper: boolean;
  digit: boolean;
  special: boolean;
  maxLength: boolean;
}
