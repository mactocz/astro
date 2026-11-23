import type { InviteAccountState, InviteAction, InviteStatus } from "@/types";

/** How long the link in an invitation e-mail works; it matches `otp_expiry` (604800 s) in `supabase/config.toml`. */
export const INVITE_VALIDITY_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function isSet(value: string | null | undefined): boolean {
  return typeof value === "string" && value !== "";
}

/**
 * The state of the Auth account behind an employee: `none` without a user, `active` once the user has confirmed (the
 * invitation was accepted or the address was confirmed), otherwise `pending`. Either confirmation field counts, as
 * Auth versions differ in which one they fill.
 */
export function classifyAuthUser(
  user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null,
): InviteAccountState {
  if (user === null) {
    return "none";
  }
  return isSet(user.email_confirmed_at) || isSet(user.confirmed_at) ? "active" : "pending";
}

/** The single decision table of the invitation route: a new account, a new link for a pending one, or a password reset. */
export function decideInviteAction(state: InviteAccountState): InviteAction {
  switch (state) {
    case "none":
      return "invite";
    case "pending":
      return "reinvite";
    case "active":
      return "reset_password";
  }
}

/**
 * The invitation as shown in the employee list. `no_account` without a linked account or a usable `invitedAt`.
 * Otherwise the link is valid for `INVITE_VALIDITY_DAYS` from `invitedAt` (the end moment itself still counts as
 * valid). `now` is passed in, so the result depends on the arguments only. Both timestamps come back as UTC ISO.
 */
export function inviteStatus(employee: { userId: string | null; invitedAt: string | null }, now: Date): InviteStatus {
  if (employee.userId === null || employee.invitedAt === null) {
    return { kind: "no_account" };
  }
  const invitedMs = Date.parse(employee.invitedAt);
  if (Number.isNaN(invitedMs)) {
    return { kind: "no_account" };
  }
  const validUntilMs = invitedMs + INVITE_VALIDITY_DAYS * DAY_MS;
  return {
    kind: "invited",
    invitedAt: new Date(invitedMs).toISOString(),
    validUntil: new Date(validUntilMs).toISOString(),
    expired: now.getTime() > validUntilMs,
  };
}

// dd.mm.rrrr in UTC, so the label does not depend on the time zone of the server or the browser.
function formatDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

/**
 * "Bez konta", "Zaproszony 06.11.2026 (link ważny do 13.11.2026)" or "Zaproszony 06.11.2026 (link wygasł 13.11.2026)".
 * The expired label speaks of the link only: acceptance is not tracked, so it is unknown whether the password was set.
 */
export function formatInviteLabel(status: InviteStatus): string {
  if (status.kind === "no_account") {
    return "Bez konta";
  }
  const link = status.expired ? "link wygasł" : "link ważny do";
  return `Zaproszony ${formatDate(status.invitedAt)} (${link} ${formatDate(status.validUntil)})`;
}

/** The text of the 422 answer (and of the read-only field in the form) when an employee with an account gets a new e-mail. */
export const EMAIL_LOCKED_MESSAGE = "E-mail jest zablokowany po zaproszeniu konta";

/** The kinds of link in the e-mails: `invite` for a new account, `recovery` for a password reset of an active one. */
export const SET_PASSWORD_LINK_TYPES = ["invite", "recovery"] as const;
export type SetPasswordLinkType = (typeof SET_PASSWORD_LINK_TYPES)[number];

// What GoTrue puts in {{ .TokenHash }}: a hexadecimal hash, with a "pkce_" prefix for a link requested over PKCE.
const TOKEN_HASH = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * The token hash and the type read from a set-password link (the query of the page, the body of the API), or null when
 * either is missing or malformed. One function for both, so the page and the route give the same answer. It checks the
 * shape only; whether the token still works is up to Auth.
 */
export function parseSetPasswordLink(
  tokenHash: unknown,
  type: unknown,
): { tokenHash: string; type: SetPasswordLinkType } | null {
  const linkType = SET_PASSWORD_LINK_TYPES.find((candidate) => candidate === type);
  if (linkType === undefined || typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)) {
    return null;
  }
  return { tokenHash, type: linkType };
}

function normalizeEmail(email: string | null): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized === undefined || normalized === "" ? null : normalized;
}

/**
 * True when an employee with a linked account would get a different e-mail address (compared trimmed and
 * case-insensitively; empty counts as none). Without an account the address may change freely.
 */
export function emailChangeBlocked(
  existing: { userId: string | null; email: string | null },
  nextEmail: string | null,
): boolean {
  return existing.userId !== null && normalizeEmail(existing.email) !== normalizeEmail(nextEmail);
}
