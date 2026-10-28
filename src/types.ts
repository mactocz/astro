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
