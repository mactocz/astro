import { z } from "zod";
import type { Employee, EmployeeFieldErrors, EmployeeInput, Fte } from "@/types";

export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;
export const FTE_DENOMINATOR_MAX = 100;

// One message per field (a single one for the whole FTE pair), shown next to the form field and returned by the API.
const FIELD_ERRORS = {
  firstName: `Podaj imię (1–${NAME_MAX_LENGTH} znaków, bez znaków sterujących).`,
  lastName: `Podaj nazwisko (1–${NAME_MAX_LENGTH} znaków, bez znaków sterujących).`,
  email: `Podaj poprawny adres e-mail (do ${EMAIL_MAX_LENGTH} znaków) albo zostaw pole puste.`,
  fte: `Podaj etat jako ułamek: licznik od 1 do mianownika, mianownik do ${FTE_DENOMINATOR_MAX}.`,
} as const;

const CONTROL_CHARS = /\p{Cc}/u;
const DIGITS_ONLY = /^\d+$/;
const emailSchema = z.email();

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Divides a fraction of positive whole numbers by their greatest common divisor, so 2/4 becomes 1/2. */
export function reduceFte(fte: Fte): Fte {
  const divisor = gcd(fte.numerator, fte.denominator);
  return { numerator: fte.numerator / divisor, denominator: fte.denominator / divisor };
}

/** "pełny etat" for 1/1, otherwise the fraction, e.g. "3/4 etatu". */
export function formatFteLabel(fte: Fte): string {
  return fte.numerator === 1 && fte.denominator === 1 ? "pełny etat" : `${fte.numerator}/${fte.denominator} etatu`;
}

/** The collapsed name, or undefined when it is empty, too long or holds a control character (tab and newline too). */
function parseName(value: unknown): string | undefined {
  // Checked on the raw string: trimming first would let a trailing newline or tab slip through.
  if (typeof value !== "string" || CONTROL_CHARS.test(value)) {
    return undefined;
  }
  const name = value.trim().replace(/\s+/gu, " ");
  const length = Array.from(name).length;
  return length >= 1 && length <= NAME_MAX_LENGTH ? name : undefined;
}

/** The lower-cased address, null when left empty, or undefined when it is not a valid address. */
function parseEmail(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const email = value.trim().toLowerCase();
  if (email === "") {
    return null;
  }
  return email.length <= EMAIL_MAX_LENGTH && emailSchema.safeParse(email).success ? email : undefined;
}

/** A whole number written with digits only (a number or a digit string), or undefined for anything else. */
function parseWholeNumber(value: unknown): number | undefined {
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" && DIGITS_ONLY.test(text) ? Number(text) : undefined;
}

/** The FTE in lowest terms, or undefined unless 1 <= numerator <= denominator <= FTE_DENOMINATOR_MAX. */
function parseFte(numeratorValue: unknown, denominatorValue: unknown): Fte | undefined {
  const numerator = parseWholeNumber(numeratorValue);
  const denominator = parseWholeNumber(denominatorValue);
  if (numerator === undefined || denominator === undefined) {
    return undefined;
  }
  // The bounds apply to the typed fraction, before it is reduced.
  if (numerator < 1 || numerator > denominator || denominator > FTE_DENOMINATOR_MAX) {
    return undefined;
  }
  return reduceFte({ numerator, denominator });
}

/**
 * Validates and normalises a raw employee with the keys `firstName`, `lastName`, `email`, `fteNumerator` and
 * `fteDenominator` (numbers or digit strings). Anything that is not an object counts as empty fields. Every invalid
 * field is reported at once.
 */
export function validateEmployeeInput(
  raw: unknown,
): { ok: true; value: EmployeeInput } | { ok: false; errors: EmployeeFieldErrors } {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const firstName = parseName(input.firstName);
  const lastName = parseName(input.lastName);
  const email = parseEmail(input.email);
  const fte = parseFte(input.fteNumerator, input.fteDenominator);

  if (firstName === undefined || lastName === undefined || email === undefined || fte === undefined) {
    const errors: EmployeeFieldErrors = {};
    if (firstName === undefined) {
      errors.firstName = FIELD_ERRORS.firstName;
    }
    if (lastName === undefined) {
      errors.lastName = FIELD_ERRORS.lastName;
    }
    if (email === undefined) {
      errors.email = FIELD_ERRORS.email;
    }
    if (fte === undefined) {
      errors.fte = FIELD_ERRORS.fte;
    }
    return { ok: false, errors };
  }
  return { ok: true, value: { firstName, lastName, email, fte } };
}

const collator = new Intl.Collator("pl");

// Plain code-unit order rather than the collator: an id is not text for people, and this never depends on locale data.
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A new list ordered by last name, first name (Polish collation), then `createdAt` (as a point in time, not as text),
 * then `id`. The result does not depend on the order of `employees`, which is left unchanged.
 */
export function sortEmployees(employees: readonly Employee[]): Employee[] {
  return [...employees].sort(
    (a, b) =>
      collator.compare(a.lastName, b.lastName) ||
      collator.compare(a.firstName, b.firstName) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      compareIds(a.id, b.id),
  );
}
