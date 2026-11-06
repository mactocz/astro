import type { PasswordCheck } from "@/types";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

// One message per part of the rule, shown next to the password field and returned by the API. They name the rule, never
// the value.
const RULE_ERRORS = {
  minLength: `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków.`,
  upper: "Hasło musi zawierać co najmniej jedną wielką literę.",
  digit: "Hasło musi zawierać co najmniej jedną cyfrę.",
  special: "Hasło musi zawierać co najmniej jeden znak specjalny, np. ! ? # (spacja się nie liczy).",
  maxLength: `Hasło jest za długie: najwyżej ${PASSWORD_MAX_LENGTH} bajtów (polskie litery liczą się podwójnie).`,
} as const satisfies Record<keyof PasswordCheck, string>;

// The order in which the first unmet part of the rule is reported.
const RULE_ORDER = ["minLength", "upper", "digit", "special", "maxLength"] as const satisfies (keyof PasswordCheck)[];

const UPPER_CASE = /\p{Lu}/u;
const DIGIT = /\d/;
// Neither a letter, a digit nor white space: punctuation, symbols and emoji count, a space does not.
const SPECIAL = /[^\p{L}\p{N}\s]/u;

const encoder = new TextEncoder();

/**
 * Which parts of the password rule from the PRD a value meets: at least 8 characters (code points), an upper-case
 * letter, a digit (0-9), a special character, and at most 72 bytes. Anything that is not a string meets nothing.
 */
export function checkPassword(raw: unknown): PasswordCheck {
  if (typeof raw !== "string") {
    return { minLength: false, upper: false, digit: false, special: false, maxLength: false };
  }
  return {
    minLength: Array.from(raw).length >= PASSWORD_MIN_LENGTH,
    upper: UPPER_CASE.test(raw),
    digit: DIGIT.test(raw),
    special: SPECIAL.test(raw),
    // non-obvious: bcrypt, and so Supabase Auth, limits the password to 72 bytes of UTF-8, not 72 characters. Counting
    // characters would accept a long password with Polish letters that Auth refuses, and by then the invitation token
    // is already spent.
    maxLength: encoder.encode(raw).length <= PASSWORD_MAX_LENGTH,
  };
}

/** Checks the password rule and reports the first unmet part with one message; there is no lower-case requirement. */
export function validatePassword(raw: unknown): { ok: true } | { ok: false; error: string } {
  const check = checkPassword(raw);
  const unmet = RULE_ORDER.find((part) => !check[part]);
  return unmet === undefined ? { ok: true } : { ok: false, error: RULE_ERRORS[unmet] };
}
