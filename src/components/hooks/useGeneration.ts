import { useState } from "react";
import { APPROVAL_MESSAGES } from "@/lib/services/approval";
import {
  formatGenerationSummary,
  formatRemovalSummary,
  generateSchedule,
  type GeneratorInput,
} from "@/lib/services/generator";
import type { AssignmentInput, GenerationResult } from "@/types";

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const NOT_FOUND_ERROR = "Nie znaleziono tego grafiku. Wróć do listy grafików i spróbuj ponownie.";
const GENERATE_ERROR = "Nie udało się zapisać propozycji. Spróbuj ponownie.";
const REMOVE_ERROR = "Nie udało się usunąć wygenerowanych przypisań. Spróbuj ponownie.";
const RULES_ERROR = "Nie udało się sprawdzić reguł czasu pracy, więc nic nie wygenerowano.";

/** What went wrong; `reload` says that the page holds old data and only loading it again helps. */
export interface GenerationFailure {
  message: string;
  reload: boolean;
}

async function readBody(response: Response): Promise<{ error?: unknown; removed?: unknown } | null> {
  try {
    return (await response.json()) as { error?: unknown; removed?: unknown } | null;
  } catch {
    return null;
  }
}

async function failureOf(response: Response, general: string): Promise<GenerationFailure> {
  switch (response.status) {
    case 401:
    case 403:
      return { message: SESSION_ERROR, reload: false };
    case 404:
      return { message: NOT_FOUND_ERROR, reload: false };
    case 409: {
      const code = (await readBody(response))?.error;
      if (code === "schedule_changed" || code === "schedule_approved") {
        return { message: APPROVAL_MESSAGES[code], reload: true };
      }
      return { message: general, reload: false };
    }
    default:
      return { message: general, reload: false };
  }
}

// The generator takes about a second for a large schedule and runs on the main thread, so the buttons are painted as
// busy before it starts.
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/**
 * The generated assignments of a draft (S-09). `generate` counts a proposal in the browser (`generateSchedule`) and stores
 * it at once with one request; when there is nothing to add it sends nothing. `remove` takes every generated assignment
 * off, after the confirmation that `ask` opens. `onAdded` and `onRemoved` bring the view in line once the server has done
 * it, without loading the page again; `basis` is the fingerprint of the data the page loaded.
 */
export function useGeneration({
  scheduleId,
  basis,
  onAdded,
  onRemoved,
}: {
  scheduleId: string;
  basis: string;
  onAdded: (additions: readonly AssignmentInput[]) => void;
  onRemoved: () => void;
}) {
  const [running, setRunning] = useState<"generating" | "removing" | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The sentences about what was done last. */
  const [notice, setNotice] = useState<readonly string[]>([]);
  const [failure, setFailure] = useState<GenerationFailure | null>(null);
  const url = `/api/schedules/${scheduleId}/generated`;

  function ask() {
    setFailure(null);
    setNotice([]);
    setConfirming(true);
  }

  function cancel() {
    setConfirming(false);
  }

  function reload() {
    window.location.replace(`/schedules/${scheduleId}/assign`);
  }

  function finish(sentences: readonly string[], next: GenerationFailure | null) {
    setNotice(sentences);
    setFailure(next);
    setConfirming(false);
    setRunning(null);
  }

  /** `input.assignments` is the list the grid shows: the server refuses a proposal when the database holds another. */
  async function generate(input: GeneratorInput) {
    setRunning("generating");
    setConfirming(false);
    setNotice([]);
    setFailure(null);
    await afterPaint();

    let result: GenerationResult;
    try {
      result = generateSchedule(input);
    } catch {
      // The rules throw a RangeError for data they reject, as for the live check.
      finish([], { message: RULES_ERROR, reload: false });
      return;
    }
    if (result.additions.length === 0) {
      finish(formatGenerationSummary(result), null);
      return;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basis, assignments: input.assignments, additions: result.additions }),
      });
      if (response.status === 200) {
        onAdded(result.additions);
        finish(formatGenerationSummary(result), null);
        return;
      }
      finish([], await failureOf(response, GENERATE_ERROR));
    } catch {
      // The request may have reached the server; trying again then answers "data changed" and asks for a reload.
      finish([], { message: GENERATE_ERROR, reload: false });
    }
  }

  async function remove() {
    setRunning("removing");
    setNotice([]);
    setFailure(null);
    try {
      const response = await fetch(url, { method: "DELETE" });
      if (response.status === 200) {
        const removed = (await readBody(response))?.removed;
        onRemoved();
        finish(typeof removed === "number" ? [formatRemovalSummary(removed)] : [], null);
        return;
      }
      finish([], await failureOf(response, REMOVE_ERROR));
    } catch {
      finish([], { message: REMOVE_ERROR, reload: false });
    }
  }

  return { running, pending: running !== null, confirming, notice, failure, ask, cancel, reload, generate, remove };
}
