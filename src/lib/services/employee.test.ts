import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  FTE_DENOMINATOR_MAX,
  NAME_MAX_LENGTH,
  formatFteLabel,
  reduceFte,
  sortEmployees,
  validateEmployeeInput,
} from "@/lib/services/employee";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import type { Employee, EmployeeField, EmployeeFieldErrors, EmployeeInput, Fte } from "@/types";

const validInput = { firstName: "Anna", lastName: "Nowak", email: "anna@firma.pl", fteNumerator: 3, fteDenominator: 4 };

function validate(overrides: Record<string, unknown> = {}) {
  return validateEmployeeInput({ ...validInput, ...overrides });
}

function validValue(overrides: Record<string, unknown> = {}): EmployeeInput {
  const result = validate(overrides);
  if (!result.ok) {
    throw new Error(`expected valid input, got errors for ${Object.keys(result.errors).join(", ")}`);
  }
  return result.value;
}

function errorsOf(overrides: Record<string, unknown> = {}): EmployeeFieldErrors {
  const result = validate(overrides);
  if (result.ok) {
    throw new Error(`expected invalid input, got ${JSON.stringify(result.value)}`);
  }
  return result.errors;
}

// Exactly one field is rejected, with a single non-empty message.
function expectOnlyError(overrides: Record<string, unknown>, field: EmployeeField) {
  const errors = errorsOf(overrides);
  expect(Object.keys(errors)).toStrictEqual([field]);
  expect(errors[field]?.trim().length).toBeGreaterThan(0);
}

describe("employee limits", () => {
  it("keeps the documented bounds", () => {
    expect([NAME_MAX_LENGTH, EMAIL_MAX_LENGTH, FTE_DENOMINATOR_MAX]).toStrictEqual([100, 254, 100]);
  });
});

describe("validateEmployeeInput normalisation", () => {
  it("trims the names, lower-cases the e-mail and reduces the FTE", () => {
    expect(
      validValue({
        firstName: "  Anna ",
        lastName: " Nowak  ",
        email: "  Anna@Firma.PL ",
        fteNumerator: 2,
        fteDenominator: 4,
      }),
    ).toStrictEqual({
      firstName: "Anna",
      lastName: "Nowak",
      email: "anna@firma.pl",
      fte: { numerator: 1, denominator: 2 },
    });
  });

  it("turns an empty e-mail into null", () => {
    expect(validValue({ email: "" }).email).toBeNull();
  });

  it("gives the same value for numbers and digit strings", () => {
    const fromNumbers = validValue({ fteNumerator: 6, fteDenominator: 8 });
    expect(validValue({ fteNumerator: "6", fteDenominator: "8" })).toStrictEqual(fromNumbers);
    expect(validValue({ fteNumerator: 6, fteDenominator: "8" })).toStrictEqual(fromNumbers);
    expect(fromNumbers.fte).toStrictEqual({ numerator: 3, denominator: 4 });
  });
});

describe("validateEmployeeInput FTE", () => {
  it.each<[number | string, number | string, Fte]>([
    [1, 1, { numerator: 1, denominator: 1 }],
    [1, 100, { numerator: 1, denominator: 100 }],
    [100, 100, { numerator: 1, denominator: 1 }],
    [99, 100, { numerator: 99, denominator: 100 }],
    [2, 4, { numerator: 1, denominator: 2 }],
    [6, 8, { numerator: 3, denominator: 4 }],
    ["3", "4", { numerator: 3, denominator: 4 }],
    ["01", "04", { numerator: 1, denominator: 4 }],
  ])("accepts %s/%s as %j", (fteNumerator, fteDenominator, expected) => {
    expect(validValue({ fteNumerator, fteDenominator }).fte).toStrictEqual(expected);
  });

  it.each<[string, unknown, unknown]>([
    ["0/2", 0, 2],
    ["3/2", 3, 2],
    ["1/101", 1, 101],
    ["1/0", 1, 0],
    ["0/0", 0, 0],
    ["1.5/2 as text", "1.5", 2],
    ["-1/2 as text", "-1", 2],
    ["1e1/2 as text", "1e1", 2],
    ["+1/2 as text", "+1", 2],
    ["1.5/2 as a number", 1.5, 2],
    ["-1/2 as a number", -1, 2],
    ["1e21/2 as a number", 1e21, 2],
    ["an empty numerator", "", 2],
    ["an empty denominator", 2, ""],
    ["a blank numerator", "  ", 2],
    ["a numerator with a space", " 1", 2],
    ["a word", "abc", 2],
    ["a boolean", true, 2],
    ["a missing numerator", undefined, 2],
    ["a missing denominator", 1, undefined],
    ["both missing", undefined, undefined],
    ["both null", null, null],
    ["a NaN numerator", NaN, 2],
    ["a NaN denominator", 1, NaN],
    ["an Infinity numerator", Infinity, 2],
    ["an Infinity denominator", 1, Infinity],
  ])("rejects %s with one message for the pair", (_label, fteNumerator, fteDenominator) => {
    expectOnlyError({ fteNumerator, fteDenominator }, "fte");
  });
});

describe("validateEmployeeInput e-mail", () => {
  it("lower-cases an address", () => {
    expect(validValue({ email: "Anna@Firma.pl" }).email).toBe("anna@firma.pl");
  });

  it.each<[string, unknown]>([
    ["spaces only", "   "],
    ["a missing value", undefined],
    ["null", null],
  ])("treats %s as no e-mail", (_label, email) => {
    expect(validValue({ email }).email).toBeNull();
  });

  it.each<[string, unknown]>([
    ["no at sign", "anna"],
    ["no top-level domain", "a@b"],
    ["a space in the address", "a b@c.pl"],
    ["no local part", "@firma.pl"],
    ["an address that is too long", `${"a".repeat(EMAIL_MAX_LENGTH)}@firma.pl`],
    ["a number", 42],
  ])("rejects %s", (_label, email) => {
    expectOnlyError({ email }, "email");
  });

  it("accepts an address of exactly the maximum length and rejects one character more", () => {
    const suffix = "@firma.pl";
    expect(validValue({ email: "a".repeat(EMAIL_MAX_LENGTH - suffix.length) + suffix }).email).toHaveLength(
      EMAIL_MAX_LENGTH,
    );
    expectOnlyError({ email: "a".repeat(EMAIL_MAX_LENGTH - suffix.length + 1) + suffix }, "email");
  });
});

describe.each(["firstName", "lastName"] as const)("validateEmployeeInput %s", (field) => {
  it.each<[string, string, string]>([
    ["a hyphenated name", "Nowak-Kowalska", "Nowak-Kowalska"],
    ["an apostrophe", "O'Brien", "O'Brien"],
    ["a Polish letter", "Łukasz", "Łukasz"],
    ["outer spaces", "  Jan  ", "Jan"],
    ["a double space", "Jan  Maria", "Jan Maria"],
    ["a no-break space", "Jan  Maria", "Jan Maria"],
    ["the maximum length", "a".repeat(NAME_MAX_LENGTH), "a".repeat(NAME_MAX_LENGTH)],
    ["the maximum length in emoji", "😀".repeat(NAME_MAX_LENGTH), "😀".repeat(NAME_MAX_LENGTH)],
  ])("accepts %s", (_label, input, expected) => {
    expect(validValue({ [field]: input })[field]).toBe(expected);
  });

  it.each<[string, unknown]>([
    ["an empty value", ""],
    ["spaces only", "   "],
    ["a missing value", undefined],
    ["null", null],
    ["a number", 42],
    ["one character too many", "a".repeat(NAME_MAX_LENGTH + 1)],
    ["one emoji too many", "😀".repeat(NAME_MAX_LENGTH + 1)],
    ["a null character", "Jan\u0000"],
    ["a tab inside", "Jan\tKowalski"],
    ["a newline inside", "Jan\nKowalski"],
    ["a trailing newline", "Jan\n"],
    ["a leading tab", "\tJan"],
    ["a delete character", "Jan\u007f"],
    ["a C1 control character", "Jan\u0085"],
  ])("rejects %s", (_label, input) => {
    expectOnlyError({ [field]: input }, field);
  });
});

describe("validateEmployeeInput errors", () => {
  it("returns every invalid field at once", () => {
    const errors = errorsOf({ firstName: "", lastName: "\t", email: "anna", fteNumerator: 0, fteDenominator: 0 });
    expect(Object.keys(errors).sort()).toStrictEqual(["email", "firstName", "fte", "lastName"]);
    for (const message of Object.values(errors)) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives each field its own message", () => {
    const errors = errorsOf({ firstName: "", lastName: "", email: "anna", fteNumerator: 0, fteDenominator: 0 });
    expect(new Set(Object.values(errors)).size).toBe(4);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string", "Anna Nowak"],
    ["a number", 42],
    ["a boolean", true],
    ["an array", []],
    ["an empty object", {}],
  ])("treats %s as empty fields and reports the required ones", (_label, raw) => {
    const result = validateEmployeeInput(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toStrictEqual(["firstName", "fte", "lastName"]);
    }
  });
});

describe("validateEmployeeInput repeatability", () => {
  it("gives the same result for repeated calls and for equivalent inputs", () => {
    const input = {
      firstName: " Anna ",
      lastName: "Nowak",
      email: "Anna@Firma.pl",
      fteNumerator: 2,
      fteDenominator: 4,
    };
    const result = expectDeterministic(validateEmployeeInput, input, {
      variants: [
        { fteDenominator: "4", fteNumerator: "2", email: "anna@firma.pl", lastName: "Nowak", firstName: "Anna" },
        { email: " ANNA@FIRMA.PL", firstName: "Anna", lastName: " Nowak", fteNumerator: 1, fteDenominator: 2 },
      ],
    });
    expect(result).toStrictEqual({
      ok: true,
      value: { firstName: "Anna", lastName: "Nowak", email: "anna@firma.pl", fte: { numerator: 1, denominator: 2 } },
    });
  });

  it("gives the same errors for repeated calls and for key order", () => {
    const input = { firstName: "", lastName: "Nowak", email: "anna", fteNumerator: 3, fteDenominator: 2 };
    const result = expectDeterministic(validateEmployeeInput, input, {
      variants: [{ fteDenominator: 2, fteNumerator: 3, email: "anna", lastName: "Nowak", firstName: "" }],
    });
    expect(result.ok).toBe(false);
  });

  it("does not change its input", () => {
    const input = {
      firstName: " Anna ",
      lastName: "Nowak",
      email: "Anna@Firma.pl",
      fteNumerator: "2",
      fteDenominator: "4",
    };
    const before = structuredClone(input);
    validateEmployeeInput(input);
    expect(input).toStrictEqual(before);
  });
});

describe("reduceFte", () => {
  it.each<[Fte, Fte]>([
    [
      { numerator: 2, denominator: 4 },
      { numerator: 1, denominator: 2 },
    ],
    [
      { numerator: 6, denominator: 8 },
      { numerator: 3, denominator: 4 },
    ],
    [
      { numerator: 50, denominator: 100 },
      { numerator: 1, denominator: 2 },
    ],
    [
      { numerator: 100, denominator: 100 },
      { numerator: 1, denominator: 1 },
    ],
    [
      { numerator: 7, denominator: 13 },
      { numerator: 7, denominator: 13 },
    ],
  ])("reduces %j to %j", (fte, expected) => {
    expect(reduceFte(fte)).toStrictEqual(expected);
  });

  it("leaves its input unchanged", () => {
    const fte = { numerator: 2, denominator: 4 };
    reduceFte(fte);
    expect(fte).toStrictEqual({ numerator: 2, denominator: 4 });
  });
});

describe("formatFteLabel", () => {
  it.each<[Fte, string]>([
    [{ numerator: 1, denominator: 1 }, "pełny etat"],
    [{ numerator: 1, denominator: 2 }, "1/2 etatu"],
    [{ numerator: 3, denominator: 4 }, "3/4 etatu"],
    [{ numerator: 1, denominator: 100 }, "1/100 etatu"],
  ])("labels %j as %s", (fte, expected) => {
    expect(formatFteLabel(fte)).toBe(expected);
  });
});

function employee(id: string, lastName: string, firstName: string, createdAt = "2026-01-01T10:00:00.000Z"): Employee {
  return { id, firstName, lastName, email: null, fte: { numerator: 1, denominator: 1 }, createdAt };
}

const ids = (employees: readonly Employee[]) => employees.map((entry) => entry.id);

describe("sortEmployees order", () => {
  it("follows Polish alphabetical order of last names", () => {
    const lastNames = ["Cybulski", "Ćma", "Lis", "Łukasz", "Mak", "Osiński", "Ósmy", "Sowa", "Śliwa", "Zając", "Żak"];
    const people = lastNames.map((lastName, index) => employee(`id-${index}`, lastName, "Jan"));

    for (const seed of [1, 2, 3]) {
      expect(sortEmployees(seededShuffle(people, seed)).map((person) => person.lastName)).toStrictEqual(lastNames);
    }
  });

  it("orders by last name before first name", () => {
    const people = [
      employee("jan", "Kowalski", "Jan"),
      employee("zofia", "Adamski", "Zofia"),
      employee("anna", "Kowalski", "Anna"),
    ];

    expect(ids(sortEmployees(people))).toStrictEqual(["zofia", "anna", "jan"]);
  });

  it("orders two people with the same name by creation time, then by id", () => {
    const people = [
      employee("a", "Nowak", "Ewa", "2026-02-01T10:00:00.000Z"),
      employee("c", "Nowak", "Ewa", "2026-01-01T10:00:00.000Z"),
      employee("b", "Nowak", "Ewa", "2026-01-01T10:00:00.000Z"),
    ];

    expect(ids(sortEmployees(people))).toStrictEqual(["b", "c", "a"]);
    expect(ids(sortEmployees([...people].reverse()))).toStrictEqual(["b", "c", "a"]);
  });

  // The earlier timestamp gets the later id, so neither an id nor a text comparison can produce the right order.
  it.each([
    ["different offsets", "2026-01-01T11:00:00+02:00", "2026-01-01T10:30:00+00:00"],
    ["a missing and a present fraction", "2026-01-01T10:00:00Z", "2026-01-01T10:00:00.5Z"],
    ["fractions of different length", "2026-01-01T10:00:00.1Z", "2026-01-01T10:00:00.12Z"],
  ])("compares creation times as points in time with %s", (_label, earlier, later) => {
    const first = employee("z", "Nowak", "Ewa", earlier);
    const second = employee("a", "Nowak", "Ewa", later);

    expect(ids(sortEmployees([second, first]))).toStrictEqual(["z", "a"]);
    expect(ids(sortEmployees([first, second]))).toStrictEqual(["z", "a"]);
  });

  it("falls back to the id when different spellings give the same instant", () => {
    const people = [
      employee("c", "Nowak", "Ewa", "2026-01-01T12:00:00+02:00"),
      employee("b", "Nowak", "Ewa", "2026-01-01T10:00:00.000Z"),
      employee("a", "Nowak", "Ewa", "2026-01-01T10:00:00Z"),
    ];

    expect(ids(sortEmployees(people))).toStrictEqual(["a", "b", "c"]);
  });
});

describe("sortEmployees repeatability", () => {
  const roster = [
    employee("zak", "Żak", "Zofia"),
    employee("nowak-2", "Nowak", "Ewa", "2026-03-01T10:00:00Z"),
    employee("kowalski-jan-late", "Kowalski", "Jan", "2026-02-05T09:00:00.5+00:00"),
    employee("lukasz", "Łukasz", "Adam"),
    employee("kowalski-anna", "Kowalski", "Anna", "2026-02-01T10:00:00Z"),
    employee("nowak-1", "Nowak", "Ewa", "2026-03-01T10:00:00Z"),
    employee("kowalski-jan-early", "Kowalski", "Jan", "2026-02-05T09:00:00.123456+00:00"),
    employee("cybulski", "Cybulski", "Piotr"),
  ];

  it("gives the same order for repeated calls and for any input order", () => {
    const variants = [1, 2, 3, 4, 5, 6].map((seed) => seededShuffle(roster, seed));

    const sorted = expectDeterministic(sortEmployees, roster, { variants });

    expect(ids(sorted)).toStrictEqual([
      "cybulski",
      "kowalski-anna",
      "kowalski-jan-early",
      "kowalski-jan-late",
      "lukasz",
      "nowak-1",
      "nowak-2",
      "zak",
    ]);
  });

  it("returns a new array and leaves the input unchanged", () => {
    const input = Object.freeze(seededShuffle(roster, 7));
    const before = structuredClone(input);

    const sorted = sortEmployees(input);

    expect(sorted).not.toBe(input);
    expect(input).toStrictEqual(before);
  });
});
