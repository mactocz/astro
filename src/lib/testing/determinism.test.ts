import { describe, expect, it } from "vitest";
import { expectDeterministic, seededShuffle } from "@/lib/testing/determinism";

// Stand-ins for domain rules (S-05): the real rules arrive later, the pattern is what matters here.
const shifts = [5, 3, 9, 1, 7, 2];
const shuffledVariants = [1, 2, 3, 4].map((seed) => seededShuffle(shifts, seed));

describe("expectDeterministic", () => {
  it("passes for a pure function that does not depend on input order", () => {
    const sortedCopy = (items: readonly number[]) => [...items].sort((a, b) => a - b);

    const result = expectDeterministic(sortedCopy, shifts, { variants: shuffledVariants });

    expect(result).toEqual([1, 2, 3, 5, 7, 9]);
  });

  it("detects a result that depends on input order", () => {
    const firstItem = (items: readonly number[]) => items[0];

    expect(() => expectDeterministic(firstItem, [1, 2, 3], { variants: [[3, 2, 1]] })).toThrow();
  });

  it("detects a result that changes between repeated calls", () => {
    let calls = 0;
    const counter = () => ++calls;

    expect(() => expectDeterministic(counter, null)).toThrow();
  });

  it("rejects a non-positive number of runs instead of silently checking nothing", () => {
    expect(() => expectDeterministic((items: readonly number[]) => items.length, shifts, { runs: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("seededShuffle", () => {
  it("is reproducible for the same seed, does not mutate its input and keeps the same elements", () => {
    const original = Object.freeze([...shifts]);

    const first = seededShuffle(original, 42);
    const second = seededShuffle(original, 42);

    expect(first).toEqual(second);
    expect(original).toEqual(shifts);
    expect([...first].sort((a, b) => a - b)).toEqual([...shifts].sort((a, b) => a - b));
  });

  it("actually reorders the input for at least one seed", () => {
    expect(shuffledVariants.some((variant) => variant.join() !== shifts.join())).toBe(true);
  });
});
