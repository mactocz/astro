import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPassword, validatePassword } from "@/lib/services/password";
import { expectDeterministic } from "@/lib/testing/determinism";
import type { PasswordCheck } from "@/types";

type Part = keyof PasswordCheck;
const PARTS: readonly Part[] = ["minLength", "upper", "digit", "special", "maxLength"];

const NOTHING_MET: PasswordCheck = { minLength: false, upper: false, digit: false, special: false, maxLength: false };

// The message for a password that must be rejected; a typo in a fixture fails loudly.
function errorOf(raw: unknown): string {
  const result = validatePassword(raw);
  if (result.ok) {
    throw new Error("expected the password to be rejected");
  }
  return result.error;
}

// Exactly the listed parts are unmet.
function expectUnmet(raw: unknown, unmet: readonly Part[]) {
  const check = checkPassword(raw);
  expect(PARTS.filter((part) => !check[part])).toStrictEqual(PARTS.filter((part) => unmet.includes(part)));
}

describe("password limits", () => {
  it("keeps the documented bounds", () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toStrictEqual([8, 72]);
  });
});

describe("validatePassword accepts", () => {
  it.each<[string, string]>([
    ["the shortest valid password (8 characters)", "Abcdef1!"],
    ["Polish letters", "Żółw123!"],
    ["an upper-case Polish letter as the only capital", "ŁÓDŹ-1a1a"],
    ["no lower-case letter at all", "ABCDEFG1!"],
    ["an underscore as the special character", "Abcdef1_"],
    ["an emoji as the special character", "Abcdef1😀"],
    ["a space next to another special character", "Abcd 1 !x"],
    ["a special character in the middle", "Abc#defg1"],
    ["a digit and a capital at the very end", "abcdef!1A"],
    ["a long passphrase", "Correct horse battery staple 7!"],
  ])("%s", (_label, password) => {
    expect(validatePassword(password)).toStrictEqual({ ok: true });
    expectUnmet(password, []);
  });

  it("accepts 72 characters", () => {
    const password = `A1!${"a".repeat(PASSWORD_MAX_LENGTH - 3)}`;

    expect(password).toHaveLength(72);
    expect(validatePassword(password)).toStrictEqual({ ok: true });
  });

  it("counts a character outside the basic plane once, not as two UTF-16 units", () => {
    // "Abcde1😀" is 8 UTF-16 units long but only 7 characters, so it is one short.
    expect("Abcde1😀").toHaveLength(8);
    expectUnmet("Abcde1😀", ["minLength"]);
    expect(validatePassword("Abcdef1😀")).toStrictEqual({ ok: true });
  });
});

describe("validatePassword rejects the length", () => {
  it("rejects 7 characters", () => {
    expectUnmet("Abcde1!", ["minLength"]);
    expect(errorOf("Abcde1!")).toBe(errorOf("A1!"));
  });

  it("rejects 73 characters", () => {
    const password = `A1!${"a".repeat(PASSWORD_MAX_LENGTH - 2)}`;

    expect(password).toHaveLength(73);
    expectUnmet(password, ["maxLength"]);
    expect(validatePassword(password).ok).toBe(false);
  });

  // Supabase Auth refuses more than 72 bytes, and Polish letters take two, so a password this long in characters
  // would pass a character count and still fail after the invitation token was spent.
  it("measures the maximum in UTF-8 bytes, so Polish letters count twice", () => {
    const fits = `A1!${"ż".repeat(34)}a`;
    const tooLong = `A1!${"ż".repeat(34)}aa`;

    expect(new TextEncoder().encode(fits)).toHaveLength(72);
    expect(Array.from(fits)).toHaveLength(38);
    expect(validatePassword(fits)).toStrictEqual({ ok: true });
    expectUnmet(tooLong, ["maxLength"]);
    expect(Array.from(tooLong)).toHaveLength(39);
  });

  it("counts an emoji as four bytes", () => {
    const fits = `A1${"😀".repeat(17)}`;
    const tooLong = `A1${"😀".repeat(18)}`;

    expect(validatePassword(fits)).toStrictEqual({ ok: true });
    expectUnmet(tooLong, ["maxLength"]);
  });
});

describe("validatePassword rejects a missing part", () => {
  it.each<[string, string, Part]>([
    ["no upper-case letter", "abcdef1!", "upper"],
    ["only lower-case Polish letters", "żółwik1!", "upper"],
    ["no digit", "Abcdefg!", "digit"],
    ["a digit that is not 0-9", "Abcdefg٣!", "digit"],
    ["no special character", "Abcdefg1", "special"],
    ["a space as the only special character", "Abcdef 1", "special"],
    ["a no-break space as the only special character", "Abcdef1 ", "special"],
    ["a tab as the only special character", "Abcdef1\t", "special"],
    ["a digit that is not 0-9 as the only candidate for special", "Abcdef1٣", "special"],
  ])("%s", (_label, password, part) => {
    expectUnmet(password, [part]);
    expect(validatePassword(password).ok).toBe(false);
  });

  it("gives every part of the rule its own message, with no value in it", () => {
    const rejected: [string, Part][] = [
      ["Abcde1!", "minLength"],
      ["abcdef1!", "upper"],
      ["Abcdefg!", "digit"],
      ["Abcdefg1", "special"],
      [`A1!${"a".repeat(70)}`, "maxLength"],
    ];
    const messages = rejected.map(([password]) => errorOf(password));

    expect(new Set(messages).size).toBe(5);
    rejected.forEach(([password, part], index) => {
      expectUnmet(password, [part]);
      expect(messages[index].trim().length).toBeGreaterThan(0);
      expect(messages[index]).not.toContain(password);
    });
  });

  it("reports the first unmet part, in the order length, capital, digit, special, maximum", () => {
    // Each password below fails several parts at once; the message is the one of the first part in that order.
    expect(errorOf("abc")).toBe(errorOf("Abcde1!"));
    expect(errorOf("abcdefgh")).toBe(errorOf("abcdef1!"));
    expect(errorOf("Abcdefgh")).toBe(errorOf("Abcdefg!"));
    expect(errorOf(`a${"b".repeat(80)}`)).toBe(errorOf("abcdef1!"));
    expect(errorOf("Abcdefg1")).not.toBe(errorOf("Abcdefg!"));
  });
});

describe("validatePassword with other input", () => {
  it.each<[string, unknown]>([
    ["an empty string", ""],
    ["white space only", "        "],
    ["null", null],
    ["undefined", undefined],
    ["a number", 12345678],
    ["a boolean", true],
    ["an array of characters", ["A", "b", "c", "d", "e", "f", "1", "!"]],
    ["an object", { password: "Abcdef1!" }],
  ])("rejects %s", (_label, raw) => {
    expect(validatePassword(raw).ok).toBe(false);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a number", 12345678],
    ["an array", ["Abcdef1!"]],
  ])("reports nothing as met for %s", (_label, raw) => {
    expect(checkPassword(raw)).toStrictEqual(NOTHING_MET);
  });
});

describe("checkPassword flags", () => {
  it("sets each flag independently of the others", () => {
    expect(checkPassword("")).toStrictEqual({
      minLength: false,
      upper: false,
      digit: false,
      special: false,
      maxLength: true,
    });
    expect(checkPassword("abc")).toStrictEqual({
      minLength: false,
      upper: false,
      digit: false,
      special: false,
      maxLength: true,
    });
    expect(checkPassword("ABCDEFGH")).toStrictEqual({
      minLength: true,
      upper: true,
      digit: false,
      special: false,
      maxLength: true,
    });
    expect(checkPassword("12345678")).toStrictEqual({
      minLength: true,
      upper: false,
      digit: true,
      special: false,
      maxLength: true,
    });
    expect(checkPassword("!!!!!!!!")).toStrictEqual({
      minLength: true,
      upper: false,
      digit: false,
      special: true,
      maxLength: true,
    });
    expect(checkPassword("Abcdef1!")).toStrictEqual({
      minLength: true,
      upper: true,
      digit: true,
      special: true,
      maxLength: true,
    });
  });

  it("keeps checking the other parts when the password is too long", () => {
    expect(checkPassword("a".repeat(80))).toStrictEqual({
      minLength: true,
      upper: false,
      digit: false,
      special: false,
      maxLength: false,
    });
  });
});

describe("password repeatability", () => {
  it.each(["Abcdef1!", "abc", "Żółw123!", `A1!${"ż".repeat(40)}`, ""])(
    "gives the same flags and the same verdict for %j every time",
    (password) => {
      expectDeterministic(checkPassword, password);
      expectDeterministic(validatePassword, password);
    },
  );

  it("returns a new object each time, so a caller changing it does not affect the next call", () => {
    const first = checkPassword("Abcdef1!");
    first.upper = false;

    expect(checkPassword("Abcdef1!").upper).toBe(true);
  });
});
