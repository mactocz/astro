import { useState } from "react";
import type { InviteResult } from "@/types";

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const INVITE_ERROR = "Nie udało się wysłać zaproszenia. Spróbuj ponownie.";

// The error codes of POST /api/employees/<id>/invite that the planner can act on.
const ERROR_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["account_exists", "Na ten adres istnieje już konto spoza Shiftly"],
  [
    "account_mismatch",
    "Konto pracownika ma inny adres e-mail niż ten zapisany. Wyjaśnij to w panelu Supabase przed wysłaniem.",
  ],
  ["mail_failed", "Nie udało się wysłać maila; sprawdź konfigurację poczty"],
  ["rate_limited", "Wysłano zbyt wiele wiadomości w krótkim czasie. Spróbuj ponownie za kilka minut."],
  [
    "sent_not_recorded",
    "Wiadomość została wysłana, ale nie udało się zapisać daty. Nie wysyłaj ponownie: poprzedni link przestałby działać.",
  ],
  ["no_email", "Pracownik nie ma adresu e-mail. Dodaj go w edycji pracownika."],
  ["not_configured", "Zaproszenia nie są skonfigurowane na serwerze."],
  ["not_found", "Nie znaleziono pracownika. Odśwież stronę."],
]);

const RESULTS: readonly InviteResult[] = ["invited", "reinvited", "password_reset"];

function successMessage(result: InviteResult, email: string | null | undefined): string {
  const address = email ? ` na adres ${email}` : "";
  switch (result) {
    case "invited":
      return `Wysłano zaproszenie${address}`;
    case "reinvited":
      return `Wysłano ponownie zaproszenie${address}`;
    case "password_reset":
      return `Wysłano link resetu hasła${address}`;
  }
}

// The body of the answer as far as this hook reads it, or null when it is not JSON.
async function readBody(response: Response): Promise<{ status?: unknown; error?: unknown } | null> {
  try {
    const body = (await response.json()) as { status?: unknown; error?: unknown } | null;
    return typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

/**
 * State and click handler of the invitation button. The route decides what the click means (a first invitation, a new
 * link or a password reset) and answers with the result; the hook only reports it. `email` is the saved address, used in
 * the confirmation text only.
 */
export function useInviteEmployee({
  employeeId,
  email,
  hasAccount,
}: {
  employeeId: string;
  email?: string | null;
  hasAccount: boolean;
}) {
  const [pending, setPending] = useState(false);
  // True once the employee has an account, also right after the first invitation: the button then offers to send again.
  const [invited, setInvited] = useState(hasAccount);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    if (pending) {
      return;
    }
    setMessage(null);
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/employees/${employeeId}/invite`, { method: "POST" });
      const body = await readBody(response);
      const result = RESULTS.find((candidate) => candidate === body?.status);
      if (response.ok && result !== undefined) {
        setInvited(true);
        setMessage(successMessage(result, email));
      } else if (response.status === 401 || response.status === 403) {
        setError(SESSION_ERROR);
      } else {
        const code = body?.error;
        setError((typeof code === "string" ? ERROR_MESSAGES.get(code) : undefined) ?? INVITE_ERROR);
      }
    } catch {
      setError(INVITE_ERROR);
    }
    setPending(false);
  }

  return { pending, invited, message, error, invite };
}
