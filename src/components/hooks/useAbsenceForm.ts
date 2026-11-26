import { useState, type SubmitEvent } from "react";
import { validateAbsenceInput } from "@/lib/services/absence";
import type { Absence, AbsenceField, AbsenceFieldErrors, AbsenceInput } from "@/types";

export type AbsenceFormValues = Record<AbsenceField, string>;
/** What the form needs of a stored absence: its id for the request and the four fields it shows. */
export type EditedAbsence = Pick<Absence, "id" | "employeeId" | "type" | "startDate" | "endDate">;

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const SAVE_ERROR = "Nie udało się zapisać. Spróbuj ponownie.";
const NOT_FOUND_ERROR = "Nie znaleziono tej nieobecności. Mogła zostać usunięta. Wróć do listy i odśwież ją.";
const UNKNOWN_EMPLOYEE_ERROR = "Nie znaleziono wybranego pracownika. Odśwież stronę i spróbuj ponownie.";

// A new absence starts empty: the person and the type are picked, never defaulted, so that no absence is entered by accident.
function initialValues(absence?: EditedAbsence): AbsenceFormValues {
  return {
    employeeId: absence?.employeeId ?? "",
    type: absence?.type ?? "",
    startDate: absence?.startDate ?? "",
    endDate: absence?.endDate ?? "",
  };
}

const FIELD_ORDER: readonly AbsenceField[] = ["employeeId", "type", "startDate", "endDate"];

// Puts the keyboard focus on the first field with an error (the fields carry the field names as ids), so a screen reader
// starts there instead of staying silent on the button.
function focusFirstInvalid(errors: AbsenceFieldErrors) {
  const field = FIELD_ORDER.find((name) => errors[name]);
  if (field) {
    document.getElementById(field)?.focus();
  }
}

// What a 422 answer says: the `errors` of the fields, or null when there are none, and whether the body names an
// `unknown_reference` (the person is gone). Both are empty when the body is not JSON.
async function readRefusal(
  response: Response,
): Promise<{ errors: AbsenceFieldErrors | null; unknownReference: boolean }> {
  try {
    const body = (await response.json()) as { errors?: unknown; error?: unknown } | null;
    return {
      errors: typeof body?.errors === "object" && body.errors !== null ? body.errors : null,
      unknownReference: body?.error === "unknown_reference",
    };
  } catch {
    return { errors: null, unknownReference: false };
  }
}

function failureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return SESSION_ERROR;
  }
  return status === 404 ? NOT_FOUND_ERROR : SAVE_ERROR;
}

/**
 * State and submit handler of the absence form. The rules live in `validateAbsenceInput`, the same function the API routes
 * call, so the form shows what the server would say; the server still validates again. Without `absence` the form adds one
 * (`POST`), with it the form corrects it (`PUT`): the person is sent unchanged, because it is not part of what a correction
 * may change.
 */
export function useAbsenceForm({ absence }: { absence?: EditedAbsence } = {}) {
  const [values, setValues] = useState(() => initialValues(absence));
  const [fieldErrors, setFieldErrors] = useState<AbsenceFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function setField(name: AbsenceField, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    // "End before start" is reported on `endDate` but depends on both days, so editing the start clears it too.
    setFieldErrors((prev) => ({ ...prev, [name]: undefined, ...(name === "startDate" ? { endDate: undefined } : {}) }));
  }

  async function save(input: AbsenceInput) {
    setFieldErrors({});
    setServerError(null);
    setPending(true);
    try {
      const response = await fetch(absence ? `/api/absences/${absence.id}` : "/api/absences", {
        method: absence ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status === 200 || response.status === 201) {
        // Stays pending until the page is gone, so a second click cannot save twice. `replace` keeps the saved form out
        // of the history: these pages are never cached, but Back would still show a form that has been submitted.
        window.location.replace("/absences");
        return;
      }
      if (response.status === 422) {
        const refusal = await readRefusal(response);
        if (refusal.errors) {
          setFieldErrors(refusal.errors);
          focusFirstInvalid(refusal.errors);
        } else {
          setServerError(refusal.unknownReference ? UNKNOWN_EMPLOYEE_ERROR : SAVE_ERROR);
        }
      } else {
        setServerError(failureMessage(response.status));
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
    const validation = validateAbsenceInput(values);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      focusFirstInvalid(validation.errors);
      return;
    }
    await save(validation.value);
  }

  return { values, fieldErrors, serverError, pending, setField, submit };
}
