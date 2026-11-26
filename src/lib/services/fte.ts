import type { Fte } from "@/types";

/** "pełny etat" for 1/1, otherwise the fraction, e.g. "3/4 etatu". */
export function formatFteLabel(fte: Fte): string {
  return fte.numerator === 1 && fte.denominator === 1 ? "pełny etat" : `${fte.numerator}/${fte.denominator} etatu`;
}
