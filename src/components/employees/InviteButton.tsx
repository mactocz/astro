import { useId } from "react";
import { CircleAlert } from "lucide-react";
import { useInviteEmployee } from "@/components/hooks/useInviteEmployee";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  employeeId: string;
  hasEmail: boolean;
  hasAccount: boolean;
  /** The employee has set a password: the click then sends a password-reset link. It does not change after a click. */
  isActive?: boolean;
  /** The saved address; it is named in the confirmation and nowhere else. */
  email?: string | null;
}

const NO_EMAIL_HINT = "Dodaj e-mail pracownika";

// "Zaproś" without an account, "Wyślij ponownie" for one that has not set a password yet, "Resetuj hasło" for an active
// one. A click never makes an account active, so a successful click only moves "Zaproś" on to "Wyślij ponownie".
function idleLabelOf(invited: boolean, isActive: boolean): string {
  if (isActive) {
    return "Resetuj hasło";
  }
  return invited ? "Wyślij ponownie" : "Zaproś";
}

export default function InviteButton({ employeeId, hasEmail, hasAccount, isActive = false, email }: Props) {
  const { pending, invited, message, error, invite } = useInviteEmployee({ employeeId, email, hasAccount });
  const hintId = useId();
  const idleLabel = idleLabelOf(invited, isActive);

  return (
    <div className="flex flex-col items-start gap-1">
      {/* While a mail is on its way the button only looks disabled (aria-disabled): a really disabled button would drop the
          keyboard focus. Without an e-mail it is disabled for good, with the reason written next to it, because a
          disabled button shows no tooltip and a touch screen has none. */}
      <Button
        type="button"
        size="sm"
        disabled={!hasEmail}
        aria-disabled={pending ? true : undefined}
        aria-describedby={hasEmail ? undefined : hintId}
        onClick={() => {
          void invite();
        }}
        className={cn(
          "rounded-lg px-3 font-medium text-white transition-colors aria-disabled:pointer-events-none aria-disabled:opacity-50",
          invited || isActive
            ? "border border-white/20 bg-white/10 hover:bg-white/20"
            : "bg-purple-600 hover:bg-purple-500",
        )}
      >
        {pending ? "Wysyłanie..." : idleLabel}
      </Button>
      {hasEmail ? null : (
        <p id={hintId} className="text-xs text-blue-100/50">
          {NO_EMAIL_HINT}
        </p>
      )}
      {/* Always rendered, so a screen reader is already watching it when the text arrives. */}
      <p role="status" className="text-xs break-all text-green-300">
        {message}
      </p>
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-xs text-red-300">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
