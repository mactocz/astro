import { describe, expect, it } from "vitest";
import { SCHEDULE_LABEL_MAX_LENGTH, STAFFING_MAX, validateScheduleInput } from "@/lib/services/schedule";
import { LABEL_INPUT_MAX_LENGTH, capLabelInput, parseCount } from "@/lib/services/schedule-form";
import { expectDeterministic } from "@/lib/testing/determinism";

const SHIFT = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";
const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

// Everything but the label is valid, so the answer is about the label alone.
function validateLabel(label: string) {
  return validateScheduleInput({
    startDate: "2026-11-11",
    label,
    staffing: [{ shiftId: SHIFT, dayOffset: 0, requiredCount: 1 }],
    employeeIds: [ANNA],
  });
}

const codePointsOf = (text: string): number => Array.from(text).length;

describe("capLabelInput", () => {
  it("takes in four times the limit of the label", () => {
    expect(LABEL_INPUT_MAX_LENGTH).toBe(SCHEDULE_LABEL_MAX_LENGTH * 4);
  });

  it.each<[string, string]>([
    ["an empty text", ""],
    ["a short label", "Tydzień 46"],
    ["double spaces and a trailing space", "Tydzień  46 "],
    ["a text of blanks only", "     "],
    ["more raw characters than the limit of the label, with the blanks of a collapsed label", "ab   ".repeat(15)],
    ["exactly the cap", "x".repeat(LABEL_INPUT_MAX_LENGTH)],
    ["the cap in emoji (two UTF-16 units each)", "😀".repeat(LABEL_INPUT_MAX_LENGTH)],
  ])("leaves %s as it is", (_label, text) => {
    expect(capLabelInput(text)).toBe(text);
  });

  it("lets a label that is valid after the whitespace is collapsed through, and the server accepts it", () => {
    const typed = "ab   ".repeat(15);

    expect(typed.length).toBeGreaterThan(SCHEDULE_LABEL_MAX_LENGTH);
    const result = validateLabel(capLabelInput(typed));
    expect(result.ok && result.value.label).toBe("ab ".repeat(14) + "ab");
  });

  it("cuts a paste that is over the cap, at the cap", () => {
    const capped = capLabelInput("x".repeat(LABEL_INPUT_MAX_LENGTH + 1));

    expect(capped).toBe("x".repeat(LABEL_INPUT_MAX_LENGTH));
  });

  it("collapses the blanks of a paste over the cap before it cuts, so its words are kept", () => {
    const pasted = `${" ".repeat(LABEL_INPUT_MAX_LENGTH + 40)}Tydzień${"\t\n ".repeat(100)}46`;

    const capped = capLabelInput(pasted);
    expect(capped).toBe(" Tydzień 46");
    const result = validateLabel(capped);
    expect(result.ok && result.value.label).toBe("Tydzień 46");
  });

  it("ends a paste that is really too long over the limit of the label, so validation reports it", () => {
    const capped = capLabelInput(`${"słowo ".repeat(400)}koniec`);

    expect(codePointsOf(capped)).toBe(LABEL_INPUT_MAX_LENGTH);
    const result = validateLabel(capped);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toStrictEqual(["label"]);
  });

  it("counts code points, not UTF-16 units, and never splits an emoji", () => {
    const capped = capLabelInput("😀".repeat(LABEL_INPUT_MAX_LENGTH + 5));

    expect(capped).toBe("😀".repeat(LABEL_INPUT_MAX_LENGTH));
    expect(capped.isWellFormed()).toBe(true);
  });

  it("copes with a huge paste", () => {
    const capped = capLabelInput("abc ".repeat(250_000));

    expect(codePointsOf(capped)).toBe(LABEL_INPUT_MAX_LENGTH);
  });

  it("gives the same answer on every call", () => {
    const capped = expectDeterministic(capLabelInput, "x".repeat(LABEL_INPUT_MAX_LENGTH * 3));

    expect(capped).toBe("x".repeat(LABEL_INPUT_MAX_LENGTH));
  });
});

describe("parseCount", () => {
  it.each<[string, string, number]>([
    ["an empty cell", "", 0],
    ["a cell of blanks", "   ", 0],
    ["zero", "0", 0],
    ["one", "1", 1],
    ["a two-digit number", "42", 42],
    ["the maximum", String(STAFFING_MAX), STAFFING_MAX],
    ["a number with spaces around it", " 12 ", 12],
    ["a number with a leading zero", "007", 7],
    ["a number above the maximum, left to the validation", String(STAFFING_MAX + 1), STAFFING_MAX + 1],
  ])("reads %s (%j) as %d", (_label, text, expected) => {
    expect(parseCount(text)).toBe(expected);
  });

  it.each<[string, string]>([
    ["a hexadecimal number", "0x10"],
    ["an exponent", "1e1"],
    ["an unfinished exponent", "1e"],
    ["a lone minus sign", "-"],
    ["a negative number", "-3"],
    ["a plus sign", "+5"],
    ["a fraction with a dot", "1.5"],
    ["a fraction with a comma", "1,5"],
    ["a trailing dot", "5."],
    ["digits and a letter", "12a"],
    ["a word", "dwa"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["digits with a space inside", "1 2"],
    ["Arabic-Indic digits", "١٢"],
    ["fullwidth digits", "１２"],
  ])("refuses %s (%j)", (_label, text) => {
    expect(parseCount(text)).toBeUndefined();
  });

  it("passes a number far above the maximum on, for the validation to refuse", () => {
    expect(parseCount("9".repeat(30))).toBeGreaterThan(STAFFING_MAX);
    expect(parseCount("9".repeat(400))).toBe(Infinity);
  });

  it("gives the same answer on every call", () => {
    expect(expectDeterministic(parseCount, " 12 ")).toBe(12);
    expect(expectDeterministic(parseCount, "1e1")).toBeUndefined();
  });
});
