// Test-only helpers for the PRD guardrail "same input, same result". Not imported from application code.
import { expect } from "vitest";

// mulberry32: a small seedable PRNG, so a shuffle with the same seed is reproducible across runs and runtimes.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a new, reproducibly shuffled copy of `items`; the same seed always gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface DeterminismOptions<I> {
  /** Total number of calls on `input`, including the first one. Defaults to 5. */
  runs?: number;
  /** Equivalent inputs (e.g. shuffled employees or shifts) that must give the same result as `input`. */
  variants?: readonly I[];
}

/**
 * Asserts that `fn` gives the same result on every repeated call with `input`, and on every equivalent variant of it.
 * Results are compared deeply and strictly, and array order matters, so a result must list its items in a canonical
 * order instead of echoing the input order. Returns the baseline result so callers can assert on its content.
 */
export function expectDeterministic<I, O>(fn: (input: I) => O, input: I, options: DeterminismOptions<I> = {}): O {
  const { runs = 5, variants = [] } = options;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new RangeError(`expectDeterministic: runs must be a positive integer, got ${runs}`);
  }

  const baseline = fn(input);
  for (let run = 2; run <= runs; run++) {
    expect(fn(input), `run ${run} of ${runs} differs from run 1 for the same input`).toStrictEqual(baseline);
  }
  variants.forEach((variant, index) => {
    expect(fn(variant), `variant ${index} gives a different result than the base input`).toStrictEqual(baseline);
  });
  return baseline;
}
