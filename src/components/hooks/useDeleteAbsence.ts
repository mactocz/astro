import { useState } from "react";

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const DELETE_ERROR = "Nie udało się usunąć nieobecności. Spróbuj ponownie.";

/**
 * State and handlers of the button that removes an absence. Removing takes two steps: the first click only asks
 * (`confirming`), the second one sends `DELETE`. The route is idempotent, so an absence that is already gone also answers
 * 200 and the planner lands on the list either way.
 */
export function useDeleteAbsence({ absenceId }: { absenceId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function askConfirmation() {
    setError(null);
    setConfirming(true);
  }

  function cancel() {
    if (pending) {
      return;
    }
    setError(null);
    setConfirming(false);
  }

  async function confirm() {
    if (pending) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/absences/${absenceId}`, { method: "DELETE" });
      if (response.status === 200) {
        // Stays pending until the page is gone, so a second click cannot send a second request. The page of the removed
        // absence is no use any more, so `replace` keeps it out of the history.
        window.location.replace("/absences");
        return;
      }
      setError(response.status === 401 || response.status === 403 ? SESSION_ERROR : DELETE_ERROR);
    } catch {
      setError(DELETE_ERROR);
    }
    setPending(false);
  }

  return { confirming, pending, error, askConfirmation, cancel, confirm };
}
