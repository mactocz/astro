import { OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { formatViolationCounter, type ViolationCounts } from "@/lib/services/violation-view";
import { cn } from "@/lib/utils";
import type { Violation, ViolationSeverity } from "@/types";

interface Props {
  /** In the canonical order of `evaluateSchedule`: critical first, then the warnings. */
  violations: readonly Violation[];
  counts: ViolationCounts;
}

// What the list says about its own limits, always: the rules judge this schedule alone. The same words are in the smoke test.
const EDGES_NOTE =
  "Reguły oceniają ten grafik. Odpoczynek na jego krawędziach (poprzedni i następny tydzień) nie jest sprawdzany: wolne na końcu i na początku grafiku liczy się jako jedna przerwa. Shiftly ostrzega i nie gwarantuje zgodności z prawem.";

// The weight is the word in front of the reason; the icon and the colour are only an addition to it.
const SEVERITY_VIEW: Record<ViolationSeverity, { word: string; Icon: LucideIcon; item: string; badge: string }> = {
  critical: {
    word: "Krytyczne",
    Icon: OctagonAlert,
    item: "border-red-400/30 bg-red-900/20",
    badge: "text-red-200",
  },
  warning: {
    word: "Ostrzeżenie",
    Icon: TriangleAlert,
    item: "border-amber-300/30 bg-amber-300/10",
    badge: "text-amber-200",
  },
};

/**
 * The violations of the live check under the people's table: a counter that a screen reader announces when it changes
 * (`aria-live="polite"`), one list item for each violation with its weight in words and its reason (which names the person
 * and the day, or the shift and the day), and the note on what is not checked. A change of the list is not an alert: the
 * errors of saving stay in `ServerError`.
 */
export function ViolationList({ violations, counts }: Props) {
  return (
    <section aria-labelledby="violations-heading" className="mt-6">
      <h2 id="violations-heading" className="mb-1 text-lg font-semibold text-white">
        Wskazania
      </h2>
      <p aria-live="polite" className="mb-2 text-sm font-medium text-white">
        {formatViolationCounter(counts)}
      </p>
      {violations.length > 0 ? (
        <ul className="space-y-2">
          {violations.map((violation) => {
            const { word, Icon, item, badge } = SEVERITY_VIEW[violation.severity];
            return (
              <li key={violation.key} className={cn("rounded-lg border px-3 py-2 text-sm text-blue-100/90", item)}>
                <span className={cn("inline-flex items-center gap-1 font-semibold whitespace-nowrap", badge)}>
                  <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  {word}
                </span>{" "}
                <span>{violation.reason}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-blue-100/50">{EDGES_NOTE}</p>
    </section>
  );
}
