import { useState, type SubmitEvent } from "react";
import type { SetPasswordLinkType } from "@/lib/services/invitation";
import { checkPassword, validatePassword } from "@/lib/services/password";

export type SetPasswordField = "password" | "passwordRepeat";
export type SetPasswordValues = Record<SetPasswordField, string>;
export type SetPasswordFieldErrors = Partial<Record<SetPasswordField, string>>;

const INVALID_LINK_ERROR = "Link wygasł lub został już użyty. Poproś planistę o nowe zaproszenie.";
const NOT_SAVED_ERROR = "Nie udało się zapisać hasła, a link został już zużyty. Poproś planistę o nowe zaproszenie.";
const SAVE_ERROR = "Nie udało się ustawić hasła. Spróbuj ponownie.";
const TRY_AGAIN_ERROR = "Nie udało się teraz sprawdzić linku. Spróbuj ponownie za kilka minut.";
const MISMATCH_ERROR = "Hasła nie są takie same.";

const FIELD_ORDER: readonly SetPasswordField[] = ["password", "passwordRepeat"];

// Puts the keyboard focus on the first field with an error (the inputs carry the field names as ids), so a screen reader
// starts there instead of staying silent on the button.
function focusFirstInvalid(errors: SetPasswordFieldErrors) {
  const field = FIELD_ORDER.find((name) => errors[name]);
  if (field) {
    document.getElementById(field)?.focus();
  }
}

// The rule of the PRD first (the same function the route uses), then the repeat. Null when both are fine.
function validate(values: SetPasswordValues): SetPasswordFieldErrors | null {
  const rule = validatePassword(values.password);
  if (!rule.ok) {
    return { password: rule.error };
  }
  return values.passwordRepeat === values.password ? null : { passwordRepeat: MISMATCH_ERROR };
}

interface SetPasswordAnswer {
  error?: unknown;
  message?: unknown;
  errors?: { password?: unknown } | null;
}

// The JSON body of an answer, or null when it is not JSON.
async function readAnswer(response: Response): Promise<SetPasswordAnswer | null> {
  try {
    const body = (await response.json()) as SetPasswordAnswer | null;
    return typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

/**
 * State and submit handler of the set-password form. The rule lives in `checkPassword` / `validatePassword`, the same
 * functions the route calls, so the form shows what the server would say; the server still validates again, before it
 * spends the token of the link.
 */
export function useSetPasswordForm({ tokenHash, type }: { tokenHash: string; type: SetPasswordLinkType }) {
  const [values, setValues] = useState<SetPasswordValues>({ password: "", passwordRepeat: "" });
  const [fieldErrors, setFieldErrors] = useState<SetPasswordFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function setField(name: SetPasswordField, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function save() {
    setFieldErrors({});
    setServerError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash, type, password: values.password }),
      });
      if (response.status === 200) {
        // Stays pending until the page is gone, so the spent token cannot be sent twice. `replace` keeps the page, and
        // the token in its address, out of the history.
        window.location.replace("/dashboard");
        return;
      }
      const answer = await readAnswer(response);
      const passwordError = answer?.errors?.password;
      if (response.status === 422 && typeof passwordError === "string") {
        const errors = { password: passwordError };
        setFieldErrors(errors);
        focusFirstInvalid(errors);
      } else if (answer?.error === "invalid_link") {
        setServerError(INVALID_LINK_ERROR);
      } else if (answer?.error === "password_not_saved" || answer?.error === "same_password") {
        setServerError(typeof answer.message === "string" ? answer.message : NOT_SAVED_ERROR);
      } else if (answer?.error === "try_again") {
        setServerError(TRY_AGAIN_ERROR);
      } else {
        setServerError(SAVE_ERROR);
      }
    } catch {
      setServerError(SAVE_ERROR);
    }
    setPending(false);
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const errors = validate(values);
    if (errors) {
      setFieldErrors(errors);
      focusFirstInvalid(errors);
      return;
    }
    await save();
  }

  return { values, check: checkPassword(values.password), fieldErrors, serverError, pending, setField, submit };
}
