import { useState, type SubmitEvent } from "react";
import { formatTime, validateShiftInput } from "@/lib/services/shift";
import type { Shift, ShiftField, ShiftFieldErrors } from "@/types";

export type ShiftFormValues = Record<ShiftField, string>;

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const SAVE_ERROR = "Nie udało się zapisać. Spróbuj ponownie.";

// The times are text in the form (`GG:MM`, as a time input holds them); a stored shift keeps them as minutes.
function initialValues(shift?: Shift): ShiftFormValues {
  return {
    name: shift?.name ?? "",
    startTime: shift ? formatTime(shift.startMinute) : "",
    endTime: shift ? formatTime(shift.endMinute) : "",
  };
}

// The `errors` of a 422 answer, or null when the body is not JSON or carries none.
async function readFieldErrors(response: Response): Promise<ShiftFieldErrors | null> {
  try {
    const body = (await response.json()) as { errors?: unknown } | null;
    return typeof body?.errors === "object" && body.errors !== null ? body.errors : null;
  } catch {
    return null;
  }
}

/**
 * State and submit handler of the shift form. The rules live in `validateShiftInput`, the same function the API routes
 * call, so the form shows what the server would say; the server still validates again.
 */
export function useShiftForm({ shift }: { shift?: Shift } = {}) {
  const [values, setValues] = useState(() => initialValues(shift));
  const [fieldErrors, setFieldErrors] = useState<ShiftFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function setField(name: ShiftField, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function save() {
    setFieldErrors({});
    setServerError(null);
    setPending(true);
    try {
      const response = await fetch(shift ? `/api/shifts/${shift.id}` : "/api/shifts", {
        method: shift ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (response.status === 200 || response.status === 201) {
        // Stays pending until the page is gone, so a second click cannot save twice.
        window.location.assign("/shifts");
        return;
      }
      if (response.status === 422) {
        const errors = await readFieldErrors(response);
        if (errors) {
          setFieldErrors(errors);
        } else {
          setServerError(SAVE_ERROR);
        }
      } else {
        setServerError(response.status === 401 || response.status === 403 ? SESSION_ERROR : SAVE_ERROR);
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
    const validation = validateShiftInput(values);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      return;
    }
    await save();
  }

  return { values, fieldErrors, serverError, pending, setField, submit };
}
