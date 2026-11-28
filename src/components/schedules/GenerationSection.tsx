import { TriangleAlert } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import type { useGeneration } from "@/components/hooks/useGeneration";
import { Button } from "@/components/ui/button";

/** The id of the description that every generated shift button of the grid points to. */
export const GENERATED_ENTRY_ID = "generated-entry-description";

interface Props {
  /** The generation of this schedule; the grid holds it too, to lock itself while a request is on its way. */
  generation: ReturnType<typeof useGeneration>;
  /** The number of generated assignments the grid shows. */
  generatedCount: number;
  /** Counts a proposal from what the grid shows and stores it. */
  onGenerate: () => void;
  /** Takes the generated assignments off. */
  onRemove: () => void;
  /** True when the rules could not be counted. */
  failed: boolean;
  /** True while an assignment is being saved. */
  saving: boolean;
  /** True while the schedule is being approved. */
  approving: boolean;
}

// Why nothing can be generated or removed until the page is loaded again, or null. The passing reasons (a click or an
// approval on its way) only disable the buttons: a sentence that came and went with every click would move the grid
// under the pointer.
function blockedReason(failed: boolean, stale: boolean): string | null {
  if (failed) {
    return "Nie można generować: nie udało się policzyć wskazań. Odśwież stronę.";
  }
  return stale ? "Odśwież stronę, zanim spróbujesz ponownie." : null;
}

const secondaryButtonClass = "rounded-lg border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white";

/**
 * The schedule generator (S-09), above the people's table: "Wygeneruj" fills the missing staff and saves at once,
 * "Usuń wygenerowane" takes those entries off after a confirmation. It holds no table, and the description of a
 * generated entry lives here and not in the grid, whose rows and cells are compared by their text.
 */
export function GenerationSection({
  generation,
  generatedCount,
  onGenerate,
  onRemove,
  failed,
  saving,
  approving,
}: Props) {
  const { running, pending, confirming, notice, failure, ask, cancel, reload } = generation;
  const reason = blockedReason(failed, failure?.reload === true);
  const disabled = reason !== null || saving || approving || pending;
  const describedBy = reason === null ? undefined : "generation-blocked";

  return (
    <section aria-labelledby="generation-heading" className="mb-4">
      <h2 id="generation-heading" className="mb-1 text-lg font-semibold text-white">
        Generowanie
      </h2>
      <p className="mb-2 text-xs text-blue-100/60">
        „Wygeneruj” dopełnia brakującą obsadę bez tworzenia krytycznych naruszeń i od razu zapisuje przypisania, a
        istniejących nie zmienia. Propozycja nie musi być najlepsza z możliwych.
      </p>
      <span id={GENERATED_ENTRY_ID} className="sr-only">
        wpis wygenerowany
      </span>

      <ServerError message={failure?.message ?? null} />
      {failure?.reload ? (
        <Button type="button" variant="outline" onClick={reload} className={`mt-2 ${secondaryButtonClass}`}>
          Odśwież stronę
        </Button>
      ) : null}

      {confirming ? (
        // As in the approval: only the sentence is the alert, and the safe button takes the focus.
        <div className="mt-2 space-y-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/90">
          <p role="alert" className="flex items-start gap-2 font-medium">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Usunąć wszystkie wygenerowane przypisania? Przypisania dodane ręcznie zostaną.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={disabled}
              onClick={onRemove}
              className="rounded-lg bg-amber-300 px-4 py-2 font-medium text-slate-900 transition-colors hover:bg-amber-200"
            >
              {running === "removing" ? "Usuwanie..." : "Usuń"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={cancel}
              autoFocus
              className={secondaryButtonClass}
            >
              Wróć
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            disabled={disabled}
            aria-describedby={describedBy}
            onClick={onGenerate}
            className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
          >
            {running === "generating" ? "Generowanie..." : "Wygeneruj"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || generatedCount === 0}
            aria-describedby={describedBy}
            onClick={ask}
            className={secondaryButtonClass}
          >
            Usuń wygenerowane
          </Button>
          {reason === null ? null : (
            <p id="generation-blocked" className="text-sm text-blue-100/80">
              {reason}
            </p>
          )}
        </div>
      )}

      {/* Always in the page, so that a screen reader hears what appears in it. */}
      <div role="status" className="text-sm text-blue-100/90">
        {notice.length > 0 ? <p className="mt-2">{notice.join(" ")}</p> : null}
      </div>
    </section>
  );
}
