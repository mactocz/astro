import { evaluateSchedule, type RuleInput } from "@/lib/services/rules";
import type { Violation } from "@/types";

/**
 * What `safeEvaluate` gives: the violations, or `{ ok: false }` when the rules could not be counted. A failure is a state of
 * its own and never an empty list, because "no violations" would read as compliance that was never checked.
 */
export type SafeEvaluation = { ok: true; violations: Violation[] } | { ok: false };

/**
 * `evaluateSchedule` that does not throw. The rules throw a RangeError by contract for a `startDate` that `parseIsoDate`
 * rejects or an FTE that `weeklyNorm` rejects. The constraints of the database are the same predicates, so no stored data
 * reaches that today, but an exception inside the render of the assignment island would end the page or unmount the only
 * surface where the planner edits. Whatever the rules throw is answered with `{ ok: false }`, so the caller shows that the
 * check did not run. The input is only read.
 */
export function safeEvaluate(input: RuleInput): SafeEvaluation {
  try {
    return { ok: true, violations: evaluateSchedule(input) };
  } catch {
    return { ok: false };
  }
}
