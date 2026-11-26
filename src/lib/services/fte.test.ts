import { describe, expect, it } from "vitest";
import { formatFteLabel } from "@/lib/services/fte";
import type { Fte } from "@/types";

describe("formatFteLabel", () => {
  it.each<[Fte, string]>([
    [{ numerator: 1, denominator: 1 }, "pełny etat"],
    [{ numerator: 3, denominator: 4 }, "3/4 etatu"],
    [{ numerator: 1, denominator: 2 }, "1/2 etatu"],
    [{ numerator: 3, denominator: 7 }, "3/7 etatu"],
  ])("labels %j as %s", (fte, expected) => {
    expect(formatFteLabel(fte)).toBe(expected);
  });

  it("leaves its input unchanged", () => {
    const fte = { numerator: 3, denominator: 4 };
    formatFteLabel(fte);
    expect(fte).toStrictEqual({ numerator: 3, denominator: 4 });
  });
});
