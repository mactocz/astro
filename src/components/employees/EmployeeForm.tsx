import { CircleAlert, Mail, User } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { useEmployeeForm } from "@/components/hooks/useEmployeeForm";
import { Button } from "@/components/ui/button";
import { EMAIL_MAX_LENGTH, FTE_DENOMINATOR_MAX, NAME_MAX_LENGTH } from "@/lib/services/employee";
import { cn } from "@/lib/utils";
import type { Employee } from "@/types";

interface Props {
  employee?: Employee;
}

const hintClass = "mt-1 text-xs text-blue-100/50";
const FTE_MESSAGE_ID = "fte-message";

interface FteInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}

// One half of the FTE fraction. FormField renders a single input with its own label and message, so the pair is built here.
function FteInput({ id, label, value, onChange, invalid }: FteInputProps) {
  return (
    <input
      id={id}
      name={id}
      type="text"
      inputMode="numeric"
      maxLength={String(FTE_DENOMINATOR_MAX).length}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={FTE_MESSAGE_ID}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className={cn(
        "w-20 rounded-lg border bg-white/10 px-3 py-2 text-center text-white transition-colors focus:ring-2 focus:outline-none",
        invalid ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
      )}
    />
  );
}

export default function EmployeeForm({ employee }: Props) {
  const { values, fieldErrors, serverError, pending, setField, submit } = useEmployeeForm({ employee });

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <FormField
        id="firstName"
        label="Imię"
        value={values.firstName}
        onChange={(value) => {
          setField("firstName", value);
        }}
        error={fieldErrors.firstName}
        maxLength={NAME_MAX_LENGTH}
        icon={<User className="size-4" />}
      />

      <FormField
        id="lastName"
        label="Nazwisko"
        value={values.lastName}
        onChange={(value) => {
          setField("lastName", value);
        }}
        error={fieldErrors.lastName}
        maxLength={NAME_MAX_LENGTH}
        icon={<User className="size-4" />}
      />

      <FormField
        id="email"
        type="email"
        label="E-mail"
        value={values.email}
        onChange={(value) => {
          setField("email", value);
        }}
        error={fieldErrors.email}
        hint={<p className={hintClass}>Opcjonalny. Potrzebny dopiero do zaproszenia do konta.</p>}
        maxLength={EMAIL_MAX_LENGTH}
        icon={<Mail className="size-4" />}
      />

      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm text-blue-100/80">Etat</legend>
        <div className="flex items-center gap-2">
          <FteInput
            id="fteNumerator"
            label="Etat: licznik"
            value={values.fteNumerator}
            onChange={(value) => {
              setField("fteNumerator", value);
            }}
            invalid={Boolean(fieldErrors.fte)}
          />
          <span aria-hidden="true" className="text-white/60">
            /
          </span>
          <FteInput
            id="fteDenominator"
            label="Etat: mianownik"
            value={values.fteDenominator}
            onChange={(value) => {
              setField("fteDenominator", value);
            }}
            invalid={Boolean(fieldErrors.fte)}
          />
        </div>
        {fieldErrors.fte ? (
          <p id={FTE_MESSAGE_ID} className="mt-1 flex items-center gap-1 text-xs text-red-300">
            <CircleAlert className="size-3" />
            {fieldErrors.fte}
          </p>
        ) : (
          <p id={FTE_MESSAGE_ID} className={hintClass}>
            np. 1/1 to pełny etat, 1/2 to pół etatu
          </p>
        )}
      </fieldset>

      <ServerError message={serverError} />

      <div className="flex items-center gap-4 pt-2">
        <Button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {pending ? "Zapisywanie..." : "Zapisz"}
        </Button>
        <a href="/employees" className="text-sm text-purple-300 hover:underline">
          Anuluj
        </a>
      </div>
    </form>
  );
}
