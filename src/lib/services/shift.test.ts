import { describe, expect, it } from "vitest";
import {
  MINUTES_PER_DAY,
  SHIFT_NAME_MAX_LENGTH,
  endsNextDay,
  formatDuration,
  formatShiftTimes,
  formatTime,
  parseTime,
  shiftDurationMinutes,
  sortShifts,
  validateShiftInput,
} from "@/lib/services/shift";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import type { Shift, ShiftField, ShiftFieldErrors, ShiftInput } from "@/types";

// The minutes after midnight for a `GG:MM` string in a fixture; a typo in a fixture fails loudly.
function minuteOf(time: string): number {
  const minute = parseTime(time);
  if (minute === undefined) {
    throw new Error(`expected a valid time, got ${time}`);
  }
  return minute;
}

function times(start: string, end: string): { startMinute: number; endMinute: number } {
  return { startMinute: minuteOf(start), endMinute: minuteOf(end) };
}

const validInput = { name: "Nocna", startTime: "22:00", endTime: "06:00" };

function validate(overrides: Record<string, unknown> = {}) {
  return validateShiftInput({ ...validInput, ...overrides });
}

function validValue(overrides: Record<string, unknown> = {}): ShiftInput {
  const result = validate(overrides);
  if (!result.ok) {
    throw new Error(`expected valid input, got errors for ${Object.keys(result.errors).join(", ")}`);
  }
  return result.value;
}

function errorsOf(overrides: Record<string, unknown> = {}): ShiftFieldErrors {
  const result = validate(overrides);
  if (result.ok) {
    throw new Error(`expected invalid input, got ${JSON.stringify(result.value)}`);
  }
  return result.errors;
}

// Exactly one field is rejected, with a single non-empty message.
function expectOnlyError(overrides: Record<string, unknown>, field: ShiftField) {
  const errors = errorsOf(overrides);
  expect(Object.keys(errors)).toStrictEqual([field]);
  expect(errors[field]?.trim().length).toBeGreaterThan(0);
}

describe("shift limits", () => {
  it("keeps the documented bounds", () => {
    expect([SHIFT_NAME_MAX_LENGTH, MINUTES_PER_DAY]).toStrictEqual([50, 1440]);
  });
});

describe("parseTime and formatTime", () => {
  it.each<[string, number]>([
    ["00:00", 0],
    ["23:59", 1439],
    ["06:05", 365],
    ["12:00", 720],
    ["22:00", 1320],
  ])("reads %s as %d minutes after midnight", (text, minute) => {
    expect(parseTime(text)).toBe(minute);
    expect(formatTime(minute)).toBe(text);
  });

  it.each(["00:00", "06:05", "09:30", "12:00", "19:07", "23:59"])("gives %s back after parse and format", (text) => {
    expect(formatTime(minuteOf(text))).toBe(text);
  });

  it("pads the hours and the minutes with leading zeros", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(5)).toBe("00:05");
    expect(formatTime(60)).toBe("01:00");
    expect(formatTime(1439)).toBe("23:59");
  });

  it.each<[string, string]>([
    ["hour 24", "24:00"],
    ["a one-digit hour", "7:00"],
    ["minute 60", "07:60"],
    ["a one-digit minute", "07:5"],
    ["seconds", "07:00:00"],
    ["a leading space", " 07:00"],
    ["a trailing space", "07:00 "],
    ["a trailing newline", "07:00\n"],
    ["a dot instead of a colon", "07.00"],
    ["no separator", "0700"],
    ["a negative hour", "-1:00"],
    ["Arabic-Indic digits", "٠٧:٠٠"],
    ["an empty string", ""],
    ["a word", "abc"],
  ])("rejects %s", (_label, text) => {
    expect(parseTime(text)).toBeUndefined();
  });
});

describe("shift duration and the next day", () => {
  it.each<[string, string, string, number, boolean]>([
    ["a day shift", "06:00", "14:00", 480, false],
    ["a night shift through midnight", "22:00", "06:00", 480, true],
    ["a shift ending exactly at midnight", "14:00", "00:00", 600, true],
    ["a short shift across midnight", "23:30", "00:30", 60, true],
    ["a shift from midnight to the last minute", "00:00", "23:59", 1439, false],
    ["the longest shift ending a minute before it starts", "08:00", "07:59", 1439, true],
    ["a one-minute shift", "12:00", "12:01", 1, false],
  ])("%s %s-%s lasts %d minutes (next day: %s)", (_label, start, end, minutes, nextDay) => {
    const shift = times(start, end);

    expect(shiftDurationMinutes(shift)).toBe(minutes);
    expect(endsNextDay(shift)).toBe(nextDay);
  });

  it("gives zero for equal times without throwing, and does not call that the next day", () => {
    const shift = times("08:00", "08:00");

    expect(shiftDurationMinutes(shift)).toBe(0);
    expect(endsNextDay(shift)).toBe(false);
  });

  it("accepts a stored shift as well as a plain object", () => {
    const stored: Shift = { id: "a", name: "Nocna", ...times("22:00", "06:00"), createdAt: "2026-01-01T10:00:00.000Z" };

    expect(shiftDurationMinutes(stored)).toBe(480);
    expect(endsNextDay(stored)).toBe(true);
    expect(formatShiftTimes(stored)).toBe("22:00–06:00");
  });
});

describe("formatDuration and formatShiftTimes", () => {
  it.each<[number, string]>([
    [480, "8 h"],
    [450, "7 h 30 min"],
    [45, "45 min"],
    [600, "10 h"],
    [1439, "23 h 59 min"],
    [60, "1 h"],
    [61, "1 h 1 min"],
    [1, "1 min"],
    [0, "0 min"],
  ])("writes %d minutes as %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  it.each<[string, string, string]>([
    ["22:00", "06:00", "22:00–06:00"],
    ["06:05", "14:35", "06:05–14:35"],
    ["00:00", "23:59", "00:00–23:59"],
  ])("writes %s and %s as %s", (start, end, expected) => {
    expect(formatShiftTimes(times(start, end))).toBe(expected);
  });

  it("joins the times with an en dash (U+2013), not a hyphen", () => {
    expect(formatShiftTimes(times("22:00", "06:00"))[5]).toBe("–");
  });
});

describe("validateShiftInput name", () => {
  it("normalises the name and the times", () => {
    expect(validValue({ name: "  Nocna  zmiana ", startTime: "22:00", endTime: "06:00" })).toStrictEqual({
      name: "Nocna zmiana",
      startMinute: 1320,
      endMinute: 360,
    });
  });

  it.each<[string, string, string]>([
    ["a digit and a letter", "Nocna 12h", "Nocna 12h"],
    ["a Polish letter", "Łąka", "Łąka"],
    ["an apostrophe", "O'Brien", "O'Brien"],
    ["outer spaces", "  Nocna  ", "Nocna"],
    ["a double space", "Nocna  zmiana", "Nocna zmiana"],
    ["a no-break space", "Nocna  zmiana", "Nocna zmiana"],
    ["the maximum length", "a".repeat(SHIFT_NAME_MAX_LENGTH), "a".repeat(SHIFT_NAME_MAX_LENGTH)],
    ["the maximum length in emoji", "😀".repeat(SHIFT_NAME_MAX_LENGTH), "😀".repeat(SHIFT_NAME_MAX_LENGTH)],
  ])("accepts %s", (_label, input, expected) => {
    expect(validValue({ name: input }).name).toBe(expected);
  });

  it.each<[string, unknown]>([
    ["an empty value", ""],
    ["spaces only", "   "],
    ["a missing value", undefined],
    ["null", null],
    ["a number", 42],
    ["one character too many", "a".repeat(SHIFT_NAME_MAX_LENGTH + 1)],
    ["one emoji too many", "😀".repeat(SHIFT_NAME_MAX_LENGTH + 1)],
    ["a null character", "Noc\u0000"],
    ["a tab inside", "Noc\tna"],
    ["a newline inside", "Noc\nna"],
    ["a trailing newline", "Nocna\n"],
    ["a leading tab", "\tNocna"],
    ["a delete character", "Nocna\u007f"],
    ["a C1 control character", "Nocna\u0085"],
  ])("rejects %s", (_label, input) => {
    expectOnlyError({ name: input }, "name");
  });
});

describe("validateShiftInput times", () => {
  it("reads the times as minutes after midnight", () => {
    const value = validValue({ startTime: "22:00", endTime: "06:00" });

    expect([value.startMinute, value.endMinute]).toStrictEqual([1320, 360]);
  });

  it.each<[string, string, string, number, number]>([
    ["a shift inside one day", "06:00", "14:00", 360, 840],
    ["a shift through midnight", "22:00", "06:00", 1320, 360],
    ["a shift ending exactly at midnight", "14:00", "00:00", 840, 0],
    ["the whole day but one minute", "08:00", "07:59", 480, 479],
    ["the first and the last minute of the day", "00:00", "23:59", 0, 1439],
  ])("accepts %s (%s to %s)", (_label, startTime, endTime, startMinute, endMinute) => {
    expect(validValue({ startTime, endTime })).toStrictEqual({ name: "Nocna", startMinute, endMinute });
  });

  it.each<[string, string]>([
    ["08:00", "08:00"],
    ["00:00", "00:00"],
    ["23:59", "23:59"],
  ])("rejects equal times %s and %s on the end time only", (startTime, endTime) => {
    expectOnlyError({ startTime, endTime }, "endTime");
  });

  it("words equal times differently from a malformed end time", () => {
    const equal = errorsOf({ startTime: "08:00", endTime: "08:00" }).endTime;
    const malformed = errorsOf({ endTime: "8:00" }).endTime;

    expect(equal).toBeDefined();
    expect(malformed).toBeDefined();
    expect(equal).not.toBe(malformed);
  });

  describe.each(["startTime", "endTime"] as const)("%s", (field) => {
    it.each<[string, unknown]>([
      ["hour 24", "24:00"],
      ["a one-digit hour", "7:00"],
      ["minute 60", "07:60"],
      ["seconds", "07:00:00"],
      ["a leading space", " 07:00"],
      ["a trailing space", "07:00 "],
      ["a trailing newline", "07:00\n"],
      ["an empty value", ""],
      ["a word", "abc"],
      ["a number", 700],
      ["a number of minutes", 420],
      ["a missing value", undefined],
      ["null", null],
      ["true", true],
    ])("rejects %s with a format message", (_label, value) => {
      expectOnlyError({ [field]: value }, field);
    });
  });

  it("gives a malformed time its format message even when both times are equal", () => {
    const errors = errorsOf({ startTime: "24:00", endTime: "24:00" });

    expect(Object.keys(errors).sort()).toStrictEqual(["endTime", "startTime"]);
    expect(errors.endTime).toBe(errorsOf({ endTime: "24:00" }).endTime);
  });
});

describe("validateShiftInput errors", () => {
  it("returns every invalid field at once", () => {
    const errors = errorsOf({ name: "", startTime: "24:00", endTime: "abc" });

    expect(Object.keys(errors).sort()).toStrictEqual(["endTime", "name", "startTime"]);
    for (const message of Object.values(errors)) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives each field its own message", () => {
    const errors = errorsOf({ name: "", startTime: "24:00", endTime: "abc" });

    expect(new Set(Object.values(errors)).size).toBe(3);
  });

  it("reports a bad name next to equal times", () => {
    const errors = errorsOf({ name: "\t", startTime: "08:00", endTime: "08:00" });

    expect(Object.keys(errors).sort()).toStrictEqual(["endTime", "name"]);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string", "Nocna 22:00-06:00"],
    ["a number", 42],
    ["a boolean", true],
    ["an array", []],
    ["an empty object", {}],
  ])("treats %s as empty fields and reports the required ones", (_label, raw) => {
    const result = validateShiftInput(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toStrictEqual(["endTime", "name", "startTime"]);
    }
  });
});

describe("validateShiftInput repeatability", () => {
  it("gives the same result for repeated calls and for equivalent inputs", () => {
    const input = { name: " Nocna  zmiana ", startTime: "22:00", endTime: "06:00" };
    const variants = [
      { endTime: "06:00", startTime: "22:00", name: "Nocna zmiana" },
      { name: "Nocna zmiana ", endTime: "06:00", startTime: "22:00" },
      ...[1, 2, 3].map((seed) => Object.fromEntries(seededShuffle(Object.entries(input), seed))),
    ];

    const result = expectDeterministic(validateShiftInput, input, { variants });

    expect(result).toStrictEqual({ ok: true, value: { name: "Nocna zmiana", startMinute: 1320, endMinute: 360 } });
  });

  it("gives the same errors for repeated calls and for key order", () => {
    const input = { name: "", startTime: "24:00", endTime: "06:00" };
    const variants = [1, 2, 3].map((seed) => Object.fromEntries(seededShuffle(Object.entries(input), seed)));

    const result = expectDeterministic(validateShiftInput, input, { variants });

    expect(result.ok).toBe(false);
  });

  it("does not change its input", () => {
    const input = { name: " Nocna  zmiana ", startTime: "22:00", endTime: "06:00" };
    const before = structuredClone(input);

    validateShiftInput(input);

    expect(input).toStrictEqual(before);
  });
});

function shift(id: string, name: string, start: string, end: string, createdAt = "2026-01-01T10:00:00.000Z"): Shift {
  return { id, name, ...times(start, end), createdAt };
}

const ids = (shifts: readonly Shift[]) => shifts.map((entry) => entry.id);

describe("sortShifts order", () => {
  it("orders by start time before name", () => {
    // By name the order would be Noc, Popołudnie, Rano.
    const shifts = [
      shift("noc", "Noc", "22:00", "06:00"),
      shift("popoludnie", "Popołudnie", "14:00", "22:00"),
      shift("rano", "Rano", "06:00", "14:00"),
    ];

    for (const seed of [1, 2, 3]) {
      expect(ids(sortShifts(seededShuffle(shifts, seed)))).toStrictEqual(["rano", "popoludnie", "noc"]);
    }
  });

  it("orders by the start time of the day, not by the length of the shift", () => {
    const shifts = [
      shift("late", "Późna", "23:59", "00:01"),
      shift("midnight", "Północ", "00:00", "23:59"),
      shift("noon", "Południe", "12:00", "12:01"),
    ];

    expect(ids(sortShifts(shifts))).toStrictEqual(["midnight", "noon", "late"]);
  });

  it("follows Polish alphabetical order of names at the same start time", () => {
    const names = ["Cyk", "Ćma", "Łąka", "Mak"];
    const shifts = names.map((name, index) => shift(`id-${index}`, name, "06:00", "14:00"));

    for (const seed of [1, 2, 3]) {
      expect(sortShifts(seededShuffle(shifts, seed)).map((entry) => entry.name)).toStrictEqual(names);
    }
  });

  // The earlier end gets the later id, so an id cannot produce the right order.
  it("orders shifts with the same start and name by end time", () => {
    const shifts = [shift("a", "Nocna", "22:00", "06:00"), shift("z", "Nocna", "22:00", "05:00")];

    expect(ids(sortShifts(shifts))).toStrictEqual(["z", "a"]);
    expect(ids(sortShifts([...shifts].reverse()))).toStrictEqual(["z", "a"]);
  });

  it("orders identical shifts by creation time, then by id", () => {
    const shifts = [
      shift("a", "Nocna", "22:00", "06:00", "2026-02-01T10:00:00.000Z"),
      shift("c", "Nocna", "22:00", "06:00", "2026-01-01T10:00:00.000Z"),
      shift("b", "Nocna", "22:00", "06:00", "2026-01-01T10:00:00.000Z"),
    ];

    expect(ids(sortShifts(shifts))).toStrictEqual(["b", "c", "a"]);
    expect(ids(sortShifts([...shifts].reverse()))).toStrictEqual(["b", "c", "a"]);
  });

  // The earlier timestamp gets the later id, so neither an id nor a text comparison can produce the right order.
  it.each([
    ["different offsets", "2026-01-01T11:00:00+02:00", "2026-01-01T10:30:00+00:00"],
    ["a missing and a present fraction", "2026-01-01T10:00:00Z", "2026-01-01T10:00:00.5Z"],
    ["fractions of different length", "2026-01-01T10:00:00.1Z", "2026-01-01T10:00:00.12Z"],
  ])("compares creation times as points in time with %s", (_label, earlier, later) => {
    const first = shift("z", "Nocna", "22:00", "06:00", earlier);
    const second = shift("a", "Nocna", "22:00", "06:00", later);

    expect(ids(sortShifts([second, first]))).toStrictEqual(["z", "a"]);
    expect(ids(sortShifts([first, second]))).toStrictEqual(["z", "a"]);
  });

  it("falls back to the id when different spellings give the same instant", () => {
    const shifts = [
      shift("c", "Nocna", "22:00", "06:00", "2026-01-01T12:00:00+02:00"),
      shift("b", "Nocna", "22:00", "06:00", "2026-01-01T10:00:00.000Z"),
      shift("a", "Nocna", "22:00", "06:00", "2026-01-01T10:00:00Z"),
    ];

    expect(ids(sortShifts(shifts))).toStrictEqual(["a", "b", "c"]);
  });
});

describe("sortShifts repeatability", () => {
  const roster = [
    shift("noc-2", "Noc", "22:00", "06:00", "2026-03-01T10:00:00Z"),
    shift("lonka", "Łąka", "14:00", "22:00"),
    shift("rano-a", "Rano", "06:00", "14:00"),
    shift("noc-late", "Noc", "22:00", "06:00", "2026-02-05T09:00:00.5+00:00"),
    shift("cma", "Ćma", "06:00", "14:00"),
    shift("mak", "Mak", "22:00", "06:00"),
    shift("noc-1", "Noc", "22:00", "06:00", "2026-03-01T10:00:00.000Z"),
    shift("rano-b", "Rano", "06:00", "13:00"),
    shift("noc-early", "Noc", "22:00", "06:00", "2026-02-05T09:00:00.123456+00:00"),
    shift("cyk", "Cyk", "06:00", "14:00"),
  ];

  it("gives the same order for repeated calls and for any input order", () => {
    const variants = [1, 2, 3, 4, 5, 6].map((seed) => seededShuffle(roster, seed));

    const sorted = expectDeterministic(sortShifts, roster, { variants });

    expect(ids(sorted)).toStrictEqual([
      "cyk",
      "cma",
      "rano-b",
      "rano-a",
      "lonka",
      "mak",
      "noc-early",
      "noc-late",
      "noc-1",
      "noc-2",
    ]);
  });

  it("returns a new array and leaves the input unchanged", () => {
    const input = Object.freeze(seededShuffle(roster, 7));
    const before = structuredClone(input);

    const sorted = sortShifts(input);

    expect(sorted).not.toBe(input);
    expect(input).toStrictEqual(before);
  });
});
