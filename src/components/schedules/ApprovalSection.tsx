import { TriangleAlert } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import type { useApproval } from "@/components/hooks/useApproval";
import { Button } from "@/components/ui/button";
import type { AssignmentInput, Violation } from "@/types";

interface Props {
  /** The approval of this schedule; the grid holds it too, to lock itself while the request is on its way. */
  approval: ReturnType<typeof useApproval>;
  /** The fingerprint of the data the page loaded (`approvalBasis`). */
  basis: string;
  /** The assignments the grid shows. */
  assignments: readonly AssignmentInput[];
  /** The findings of the live check, as the list above shows them. */
  violations: readonly Violation[];
  /** True when the rules could not be counted. */
  failed: boolean;
  /** True while an assignment is being saved. */
  saving: boolean;
}

// Why the schedule cannot be approved right now, or null when it can. The words are shown next to the disabled button.
function blockedReason({
  violations,
  failed,
  saving,
  stale,
}: Pick<Props, "violations" | "failed" | "saving"> & { stale: boolean }): string | null {
  if (failed) {
    return "Nie można zatwierdzić: nie udało się policzyć wskazań. Odśwież stronę.";
  }
  if (stale) {
    return "Odśwież stronę, zanim spróbujesz zatwierdzić ponownie.";
  }
  if (violations.some((violation) => violation.severity === "critical")) {
    return "Nie można zatwierdzić: lista wskazań ma krytyczne naruszenia.";
  }
  return saving ? "Poczekaj, aż zapiszą się przypisania." : null;
}

/**
 * The approval of the schedule (S-08), under the coverage table. The button opens a confirmation that is always shown:
 * approving is final. It lists the current warnings, and confirming sends their keys; the server counts the rules again
 * from the database and refuses when they differ.
 */
export function ApprovalSection({ approval, basis, assignments, violations, failed, saving }: Props) {
  const { open, pending, failure, ask, cancel, approve, reload } = approval;
  const reason = blockedReason({ violations, failed, saving, stale: failure?.reload === true });
  const warnings = violations.filter((violation) => violation.severity === "warning");

  return (
    <section aria-labelledby="approval-heading" className="mt-6" data-approval-basis={basis}>
      <h2 id="approval-heading" className="mb-1 text-lg font-semibold text-white">
        Zatwierdzanie
      </h2>
      <p className="mb-3 text-xs text-blue-100/60">
        Zatwierdzony grafik jest zablokowany do edycji i zachowuje wskazania z chwili zatwierdzenia.
      </p>

      <ServerError message={failure?.message ?? null} />
      {failure?.reload ? (
        <Button
          type="button"
          variant="outline"
          onClick={reload}
          className="mt-2 rounded-lg border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
        >
          Odśwież stronę
        </Button>
      ) : null}

      {open && reason === null ? (
        // Only the sentence is the alert, so a screen reader does not read the list and the buttons out with it; the safe
        // button takes the focus.
        <div className="mt-2 space-y-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/90">
          <p role="alert" className="flex items-start gap-2 font-medium">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Zatwierdzenie jest ostateczne: grafik zostanie zablokowany do edycji i nie można tego cofnąć.
          </p>
          {warnings.length === 0 ? (
            <p>Grafik nie ma ostrzeżeń.</p>
          ) : (
            <>
              <p>{`Zatwierdzasz grafik z ostrzeżeniami (${warnings.length}):`}</p>
              <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5">
                {warnings.map((warning) => (
                  <li key={warning.key}>{warning.reason}</li>
                ))}
              </ul>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                void approve({
                  confirmedKeys: warnings.map((warning) => warning.key),
                  basis,
                  assignments: [...assignments],
                });
              }}
              className="rounded-lg bg-amber-300 px-4 py-2 font-medium text-slate-900 transition-colors hover:bg-amber-200"
            >
              {pending ? "Zatwierdzanie..." : "Zatwierdź"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={cancel}
              autoFocus
              className="rounded-lg border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              Wróć
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            disabled={reason !== null}
            aria-describedby={reason === null ? undefined : "approval-blocked"}
            onClick={ask}
            className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
          >
            Zatwierdź grafik
          </Button>
          {reason === null ? null : (
            <p id="approval-blocked" className="text-sm text-blue-100/80">
              {reason}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
