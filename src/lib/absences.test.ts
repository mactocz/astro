import { describe, expect, it } from "vitest";
import { absencesOfRoster } from "@/lib/absences";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";
import type { Absence } from "@/types";

const ANNA = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const BARTEK = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const CEZARY = "3a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d";

function absence(id: string, employeeId: string): Absence {
  return {
    id,
    employeeId,
    type: "vacation",
    status: "approved",
    startDate: "2026-11-03",
    endDate: "2026-11-05",
    createdAt: "2026-11-01T10:00:00.000Z",
  };
}

describe("absencesOfRoster", () => {
  const rows = [
    absence("a-1", ANNA),
    absence("a-2", BARTEK),
    absence("a-3", ANNA),
    absence("a-4", CEZARY),
    absence("a-5", BARTEK),
  ];

  it("keeps the absences of the people of the roster, in the order they come in, and drops the others", () => {
    expect(absencesOfRoster(rows, [ANNA, CEZARY]).map(({ id }) => id)).toStrictEqual(["a-1", "a-3", "a-4"]);
  });

  it("passes the rows themselves through, not copies", () => {
    const [first] = absencesOfRoster(rows, [ANNA]);

    expect(first).toBe(rows[0]);
  });

  it("gives nothing for an empty roster", () => {
    expect(absencesOfRoster(rows, [])).toStrictEqual([]);
  });

  it("gives nothing when nobody of the roster is absent", () => {
    expect(absencesOfRoster(rows, ["00000000-0000-4000-8000-000000000000"])).toStrictEqual([]);
  });

  it("gives nothing for no absences", () => {
    expect(absencesOfRoster([], [ANNA, BARTEK])).toStrictEqual([]);
  });

  it("does not mind an id that is listed twice in the roster", () => {
    expect(absencesOfRoster(rows, [BARTEK, BARTEK]).map(({ id }) => id)).toStrictEqual(["a-2", "a-5"]);
  });

  it("does not match an id that only differs in letter case, as the roster holds the ids the database gave", () => {
    expect(absencesOfRoster(rows, [ANNA.toUpperCase()])).toStrictEqual([]);
  });

  it("works on a list row with only the person, and keeps whatever else it carries", () => {
    const list = [
      { employeeId: ANNA, note: "first" },
      { employeeId: BARTEK, note: "second" },
    ];

    expect(absencesOfRoster(list, [BARTEK])).toStrictEqual([{ employeeId: BARTEK, note: "second" }]);
  });

  it("gives the same rows for repeated calls and for any order of the roster", () => {
    const roster = [ANNA, BARTEK, CEZARY];

    const kept = expectDeterministic((people: readonly string[]) => absencesOfRoster(rows, people), roster, {
      variants: [1, 2, 3, 4].map((seed) => seededShuffle(roster, seed)),
    });

    expect(kept).toHaveLength(rows.length);
  });

  it("returns a new list and leaves the rows and the roster unchanged", () => {
    const input = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
    const roster = Object.freeze([ANNA]);
    const before = structuredClone({ input, roster });

    const kept = absencesOfRoster(input, roster);

    expect(structuredClone({ input, roster })).toStrictEqual(before);
    expect(kept).not.toBe(input);
    expect(Object.isFrozen(kept)).toBe(false);
  });
});
