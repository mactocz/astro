import { useEffect, useId, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { useDeleteAbsence } from "@/components/hooks/useDeleteAbsence";
import { Button } from "@/components/ui/button";

interface Props {
  absenceId: string;
  /** Names the absence in the question: the person, the type and the days. */
  summary: string;
}

export default function DeleteAbsenceButton({ absenceId, summary }: Props) {
  const { confirming, pending, error, askConfirmation, cancel, confirm } = useDeleteAbsence({ absenceId });
  const questionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Taking the question back gives the focus back to the button that asked it, which is not in the page while the question
  // is.
  useEffect(() => {
    if (wasConfirming.current && !confirming) {
      triggerRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={askConfirmation}
        className="rounded-lg border-red-400/40 bg-red-500/10 px-4 py-2 text-red-200 hover:bg-red-500/20 hover:text-red-100"
      >
        Usuń nieobecność
      </Button>
    );
  }

  return (
    <div role="group" aria-labelledby={questionId} className="rounded-xl border border-red-400/30 bg-red-900/20 p-4">
      <p id={questionId} className="text-sm break-words text-red-100">
        {`Usunąć nieobecność: ${summary}? Tego nie można cofnąć.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {/* The safe answer has the focus, so that Enter right after the question does not remove anything. While the request
            is on its way the buttons only look disabled (aria-disabled): a really disabled button would drop the focus. */}
        <Button
          type="button"
          variant="outline"
          autoFocus
          aria-disabled={pending ? true : undefined}
          onClick={cancel}
          className="rounded-lg border-white/20 bg-white/10 px-4 py-2 text-white hover:bg-white/20 hover:text-white aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          Anuluj
        </Button>
        <Button
          type="button"
          aria-disabled={pending ? true : undefined}
          onClick={() => {
            void confirm();
          }}
          className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-colors hover:bg-red-500 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          {pending ? "Usuwanie..." : "Tak, usuń"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-1 text-xs text-red-300">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
