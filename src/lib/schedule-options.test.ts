import { describe, expect, it } from "vitest";
import { toEmployeeOptions, toShiftOptions } from "@/lib/schedule-options";
import type { Employee, Fte, Shift } from "@/types";

// An employee with everything the roster holds. The options must keep only the id, the name and the FTE: the page hands
// them to a React island, so whatever they carry ends up in the HTML that every planner's browser receives.
function employee(
  id: string,
  firstName: string,
  lastName: string,
  fte: Fte = { numerator: 3, denominator: 4 },
): Employee {
  return {
    id,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
    fte,
    createdAt: "2026-01-01T10:00:00.000Z",
    userId: "6f1e4d2c-3b5a-4c7d-8e9f-0a1b2c3d4e5f",
    invitedAt: "2026-01-02T10:00:00.000Z",
    activatedAt: "2026-01-03T10:00:00.000Z",
  };
}

function shift(id: string, name: string, startMinute: number, endMinute: number): Shift {
  return { id, name, startMinute, endMinute, createdAt: "2026-01-01T10:00:00.000Z" };
}

describe("toEmployeeOptions", () => {
  // Two different FTEs, so that each option has to carry its own.
  const employees = [
    employee("e-2", "Bartek", "Nowak", { numerator: 1, denominator: 2 }),
    employee("e-1", "Anna", "Kowalska"),
  ];

  it("gives exactly the id, the name and the FTE of each employee, last name first", () => {
    expect(toEmployeeOptions(employees)).toStrictEqual([
      { id: "e-2", name: "Nowak Bartek", fte: { numerator: 1, denominator: 2 } },
      { id: "e-1", name: "Kowalska Anna", fte: { numerator: 3, denominator: 4 } },
    ]);
  });

  it("gives objects with no key but id, name and fte", () => {
    for (const option of toEmployeeOptions(employees)) {
      expect(Object.keys(option).sort()).toStrictEqual(["fte", "id", "name"]);
      expect(Object.keys(option.fte).sort()).toStrictEqual(["denominator", "numerator"]);
    }
  });

  it("lets neither an e-mail address nor any other field of the roster through", () => {
    const text = JSON.stringify(toEmployeeOptions(employees));

    expect(text).not.toContain("@");
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("email");
    expect(text).not.toContain("firstName");
    expect(text).not.toContain("lastName");
    expect(text).not.toContain("6f1e4d2c-3b5a-4c7d-8e9f-0a1b2c3d4e5f");
    expect(text).not.toContain("2026-01-0");
  });

  it("gives each option its own copy of the FTE", () => {
    const [first] = toEmployeeOptions(employees);

    expect(first.fte).toStrictEqual(employees[0].fte);
    expect(first.fte).not.toBe(employees[0].fte);
  });

  it("keeps the order of the list it is given", () => {
    expect(toEmployeeOptions(employees).map((option) => option.id)).toStrictEqual(["e-2", "e-1"]);
  });

  it("gives an empty list for no employees", () => {
    expect(toEmployeeOptions([])).toStrictEqual([]);
  });

  it("returns new objects and leaves the input unchanged", () => {
    const input = Object.freeze(employees.map((entry) => Object.freeze({ ...entry })));
    const before = structuredClone(input);

    const options = toEmployeeOptions(input);

    expect(structuredClone(input)).toStrictEqual(before);
    expect(options).not.toBe(input);
  });
});

describe("toShiftOptions", () => {
  // Out of order on purpose: the options keep the order they are given.
  const shifts = [shift("s-2", "Nocna", 1320, 360), shift("s-1", "Poranna", 360, 840)];

  it("gives exactly the id, name, times, next-day flag, duration and minutes of each shift", () => {
    expect(toShiftOptions(shifts)).toStrictEqual([
      {
        id: "s-2",
        name: "Nocna",
        times: "22:00–06:00",
        endsNextDay: true,
        duration: "8 h",
        startMinute: 1320,
        endMinute: 360,
      },
      {
        id: "s-1",
        name: "Poranna",
        times: "06:00–14:00",
        endsNextDay: false,
        duration: "8 h",
        startMinute: 360,
        endMinute: 840,
      },
    ]);
  });

  it("gives objects with no key beyond the seven of the option", () => {
    for (const option of toShiftOptions(shifts)) {
      expect(Object.keys(option).sort()).toStrictEqual([
        "duration",
        "endMinute",
        "endsNextDay",
        "id",
        "name",
        "startMinute",
        "times",
      ]);
    }
  });

  it("leaves the creation time of the shift out", () => {
    expect(JSON.stringify(toShiftOptions(shifts))).not.toContain("createdAt");
  });

  it("keeps the order of the list it is given", () => {
    expect(toShiftOptions(shifts).map((option) => option.id)).toStrictEqual(["s-2", "s-1"]);
  });

  it("gives an empty list for no shifts", () => {
    expect(toShiftOptions([])).toStrictEqual([]);
  });

  it("returns new objects and leaves the input unchanged", () => {
    const input = Object.freeze(shifts.map((entry) => Object.freeze({ ...entry })));
    const before = structuredClone(input);

    const options = toShiftOptions(input);

    expect(structuredClone(input)).toStrictEqual(before);
    expect(options).not.toBe(input);
  });
});
