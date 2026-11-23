import { Check, Circle, Lock } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { useSetPasswordForm } from "@/components/hooks/useSetPasswordForm";
import { Button } from "@/components/ui/button";
import type { SetPasswordLinkType } from "@/lib/services/invitation";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/services/password";
import { cn } from "@/lib/utils";
import type { PasswordCheck } from "@/types";

interface Props {
  tokenHash: string;
  type: SetPasswordLinkType;
}

const RULES_ID = "password-rules";

// The parts of the rule from the PRD, in the order the route reports them. The length limit is not listed: it only
// matters for a very long password, and then it gets a line of its own.
const RULES = [
  { key: "minLength", label: `Co najmniej ${PASSWORD_MIN_LENGTH} znaków` },
  { key: "upper", label: "Wielka litera" },
  { key: "digit", label: "Cyfra" },
  { key: "special", label: "Znak specjalny, np. ! ? # (spacja się nie liczy)" },
] as const satisfies readonly { key: keyof PasswordCheck; label: string }[];

const TOO_LONG_LABEL = `Najwyżej ${PASSWORD_MAX_LENGTH} bajty; polskie litery zajmują po dwa`;

export default function SetPasswordForm({ tokenHash, type }: Props) {
  const { values, check, fieldErrors, serverError, pending, setField, submit } = useSetPasswordForm({
    tokenHash,
    type,
  });
  const repeatMatches = values.passwordRepeat === values.password;
  let repeatMessage = "";
  if (values.passwordRepeat !== "") {
    repeatMessage = repeatMatches ? "Hasła są takie same." : "Hasła muszą być takie same.";
  }
  // Always rendered, so a screen reader is already watching the line when its text arrives.
  const repeatHint = (
    <p aria-live="polite" className={cn("mt-1 min-h-4 text-xs", repeatMatches ? "text-green-300" : "text-blue-100/60")}>
      {repeatMessage}
    </p>
  );

  return (
    <form method="post" className="space-y-4" onSubmit={submit} noValidate data-set-password-form>
      <div>
        <FormField
          id="password"
          type="password"
          label="Hasło"
          value={values.password}
          onChange={(value) => {
            setField("password", value);
          }}
          error={fieldErrors.password}
          autoComplete="new-password"
          describedBy={RULES_ID}
          icon={<Lock className="size-4" />}
        />
        {/* The status word is for screen readers: the icon and the colour say the same to everybody else. */}
        <ul id={RULES_ID} aria-live="polite" aria-label="Wymagania wobec hasła" className="mt-2 space-y-1 text-xs">
          {RULES.map(({ key, label }) => (
            <li key={key} className={cn("flex items-center gap-2", check[key] ? "text-green-300" : "text-blue-100/60")}>
              {check[key] ? <Check className="size-3 shrink-0" /> : <Circle className="size-3 shrink-0" />}
              <span>{label}</span>
              <span className="sr-only">{check[key] ? "spełniony" : "niespełniony"}</span>
            </li>
          ))}
          {check.maxLength ? null : (
            <li className="flex items-center gap-2 text-red-300">
              <Circle className="size-3 shrink-0" />
              <span>{TOO_LONG_LABEL}</span>
            </li>
          )}
        </ul>
      </div>

      <FormField
        id="passwordRepeat"
        type="password"
        label="Powtórz hasło"
        value={values.passwordRepeat}
        onChange={(value) => {
          setField("passwordRepeat", value);
        }}
        error={fieldErrors.passwordRepeat}
        autoComplete="new-password"
        hint={repeatHint}
        icon={<Lock className="size-4" />}
      />

      <ServerError message={serverError} />

      <Button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {pending ? "Zapisywanie..." : "Ustaw hasło"}
      </Button>
    </form>
  );
}
