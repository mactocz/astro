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

/** The state of the Auth account behind an employee: no account, one that never confirmed its invitation, or an active one. */
export type InviteAccountState = "none" | "pending" | "active";

/** What the invitation route does for an account state: a first invitation, a new link, or a password-reset link. */
export type InviteAction = "invite" | "reinvite" | "reset_password";

/** What the invitation route answers on success; one value per `InviteAction`. */
export type InviteResult = "invited" | "reinvited" | "password_reset";

/** The invitation as the planner sees it in the employee list. `validUntil` and `invitedAt` are ISO timestamps (UTC). */
export type InviteStatus =
  { kind: "no_account" } | { kind: "invited"; invitedAt: string; validUntil: string; expired: boolean };

/** One flag per part of the password rule, true when that part is met. */
export interface PasswordCheck {
  minLength: boolean;
  upper: boolean;
  digit: boolean;
  special: boolean;
  maxLength: boolean;
}
