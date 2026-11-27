import { useState } from "react";
import { APPROVAL_MESSAGES, type ApprovalRequest } from "@/lib/services/approval";

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const NOT_FOUND_ERROR = "Nie znaleziono tego grafiku. Wróć do listy grafików i spróbuj ponownie.";
const APPROVE_ERROR = "Nie udało się zatwierdzić grafiku. Spróbuj ponownie.";

/** What went wrong; `reload` says that the page holds old data and only loading it again helps. */
export interface ApprovalFailure {
  message: string;
  reload: boolean;
}

async function errorCode(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return body?.error ?? null;
  } catch {
    return null;
  }
}

/**
 * The approval of a schedule from the assignment page (S-08): whether the confirmation is open, the request and what it
 * answered. On success, and when the schedule turns out to be approved already, the page is loaded again and comes back
 * read only. A 409 about the findings or the data means that the page holds old data (the findings are counted from what
 * was loaded), so it asks for a reload instead of trying again.
 */
export function useApproval(scheduleId: string) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApprovalFailure | null>(null);

  function ask() {
    setFailure(null);
    setOpen(true);
  }

  function cancel() {
    setOpen(false);
  }

  function reload() {
    window.location.replace(`/schedules/${scheduleId}/assign`);
  }

  async function approve(request: ApprovalRequest) {
    setPending(true);
    setFailure(null);
    let next: ApprovalFailure;
    try {
      const response = await fetch(`/api/schedules/${scheduleId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (response.status === 200) {
        // Stays pending until the page is gone.
        reload();
        return;
      }
      const code = response.status === 409 || response.status === 503 ? await errorCode(response) : null;
      if (code === "schedule_approved") {
        reload();
        return;
      }
      if (code === "critical_violations" || code === "confirmation_required" || code === "schedule_changed") {
        next = { message: APPROVAL_MESSAGES[code], reload: true };
      } else if (code === "rules_unavailable") {
        next = { message: APPROVAL_MESSAGES.rules_unavailable, reload: false };
      } else if (response.status === 401 || response.status === 403) {
        next = { message: SESSION_ERROR, reload: false };
      } else {
        next = { message: response.status === 404 ? NOT_FOUND_ERROR : APPROVE_ERROR, reload: false };
      }
    } catch {
      // The request may have reached the server; trying again then answers "approved already" and reloads.
      next = { message: APPROVE_ERROR, reload: false };
    }
    setPending(false);
    setOpen(false);
    setFailure(next);
  }

  return { open, pending, failure, ask, cancel, approve, reload };
}
