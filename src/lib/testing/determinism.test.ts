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

    expect(() => expectDeterministic(firstItem, [1, 2, 3], { variants: [[3, 2, 1]] })).toThrow(/variant 0/);
  });

  it("requires a canonical result order instead of echoing the input order", () => {
    const echo = (items: readonly number[]) => [...items];

    expect(() => expectDeterministic(echo, [1, 2, 3], { variants: [[3, 2, 1]] })).toThrow(/variant 0/);
  });

  it("detects a result that changes between repeated calls", () => {
    let calls = 0;
    const counter = () => ++calls;

    expect(() => expectDeterministic(counter, null)).toThrow(/run 2 of 5/);
  });

  it("rejects a non-positive number of runs instead of silently checking nothing", () => {
    expect(() => expectDeterministic((items: readonly number[]) => items.length, shifts, { runs: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("expectDeterministic guards against vacuous passes", () => {
  it("rejects an async function instead of comparing unrelated promises", () => {
    expect(() => expectDeterministic(() => Promise.resolve(Math.random()), null)).toThrow(TypeError);
  });

  it("rejects a configuration that would compare nothing", () => {
    expect(() => expectDeterministic(() => Math.random(), null, { runs: 1 })).toThrow(RangeError);
    expect(() => expectDeterministic(() => Math.random(), null, { runs: 1, variants: [] })).toThrow(RangeError);
  });
});

describe("seededShuffle", () => {
  it("is reproducible for the same seed, does not mutate its input and keeps the same elements", () => {
    const original = Object.freeze([...shifts]);

    const first = seededShuffle(original, 42);
    const second = seededShuffle(original, 42);

    expect(first).toEqual(second);
    // Golden vector: pins the PRNG so the order stays identical across runtimes and versions.
    expect(seededShuffle(shifts, 42)).toEqual([3, 5, 7, 2, 9, 1]);
    expect(original).toEqual(shifts);
    expect([...first].sort((a, b) => a - b)).toEqual([...shifts].sort((a, b) => a - b));
  });

  it("gives different orders for different seeds", () => {
    expect(new Set(shuffledVariants.map((variant) => variant.join())).size).toBeGreaterThan(1);
  });

  it("actually reorders the input for at least one seed", () => {
    expect(shuffledVariants.some((variant) => variant.join() !== shifts.join())).toBe(true);
  });
});
