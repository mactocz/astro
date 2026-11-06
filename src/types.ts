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
}

export type ScheduleField = "startDate" | "label" | "staffing" | "employeeIds";
export type ScheduleFieldErrors = Partial<Record<ScheduleField, string>>;
