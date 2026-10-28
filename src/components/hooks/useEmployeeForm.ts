import { useState, type SubmitEvent } from "react";
import { validateEmployeeInput } from "@/lib/services/employee";
import type { Employee, EmployeeField, EmployeeFieldErrors } from "@/types";

export type EmployeeFormField = "firstName" | "lastName" | "email" | "fteNumerator" | "fteDenominator";
export type EmployeeFormValues = Record<EmployeeFormField, string>;

const SESSION_ERROR = "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.";
const SAVE_ERROR = "Nie udało się zapisać. Spróbuj ponownie.";

function initialValues(employee?: Employee): EmployeeFormValues {
  return {
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    email: employee?.email ?? "",
    fteNumerator: String(employee?.fte.numerator ?? 1),
    fteDenominator: String(employee?.fte.denominator ?? 1),
  };
}

// The two FTE inputs share one error.
function errorKey(field: EmployeeFormField): EmployeeField {
  return field === "fteNumerator" || field === "fteDenominator" ? "fte" : field;
}

// The `errors` of a 409 / 422 answer, or null when the body is not JSON or carries none.
async function readFieldErrors(response: Response): Promise<EmployeeFieldErrors | null> {
  try {
    const body = (await response.json()) as { errors?: unknown } | null;
    return typeof body?.errors === "object" && body.errors !== null ? body.errors : null;
  } catch {
    return null;
  }
}

/**
 * State and submit handler of the employee form. The rules live in `validateEmployeeInput`, the same function the API
 * routes call, so the form shows what the server would say; the server still validates again.
 */
export function useEmployeeForm({ employee }: { employee?: Employee } = {}) {
  const [values, setValues] = useState(() => initialValues(employee));
  const [fieldErrors, setFieldErrors] = useState<EmployeeFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function setField(name: EmployeeFormField, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [errorKey(name)]: undefined }));
  }

  async function save() {
    setFieldErrors({});
    setServerError(null);
    setPending(true);
    try {
      const response = await fetch(employee ? `/api/employees/${employee.id}` : "/api/employees", {
        method: employee ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (response.status === 200 || response.status === 201) {
        // Stays pending until the page is gone, so a second click cannot save twice.
        window.location.assign("/employees");
        return;
      }
      if (response.status === 409 || response.status === 422) {
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
    const validation = validateEmployeeInput(values);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      return;
    }
    await save();
  }

  return { values, fieldErrors, serverError, pending, setField, submit };
}
