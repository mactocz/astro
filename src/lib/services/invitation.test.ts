import { describe, expect, it } from "vitest";
import {
  EMAIL_LOCKED_MESSAGE,
  INVITE_VALIDITY_DAYS,
  classifyAuthUser,
  decideInviteAction,
  emailChangeBlocked,
  formatInviteLabel,
  inviteStatus,
  parseSetPasswordLink,
} from "@/lib/services/invitation";
import { expectDeterministic } from "@/lib/testing/determinism";
import type { InviteAccountState, InviteAction, InviteStatus } from "@/types";

const INVITED_AT = "2026-11-06T10:00:00.000Z";
const VALID_UNTIL = "2026-11-13T10:00:00.000Z";
const ACTIVATED_AT = "2026-11-09T14:30:00.000Z";
const USER_ID = "0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90";

function status(
  invitedAt: string | null,
  now: string,
  userId: string | null = USER_ID,
  activatedAt: string | null = null,
): InviteStatus {
  return inviteStatus({ userId, invitedAt, activatedAt }, new Date(now));
}

describe("invitation limits", () => {
  it("keeps the documented validity of the link", () => {
    expect(INVITE_VALIDITY_DAYS).toBe(7);
  });
});

describe("classifyAuthUser", () => {
  it.each<[string, Parameters<typeof classifyAuthUser>[0], InviteAccountState]>([
    ["no user", null, "none"],
    ["a user with neither field", {}, "pending"],
    ["both fields null", { email_confirmed_at: null, confirmed_at: null }, "pending"],
    ["both fields empty", { email_confirmed_at: "", confirmed_at: "" }, "pending"],
    ["email_confirmed_at set", { email_confirmed_at: "2026-11-06T10:00:00Z", confirmed_at: null }, "active"],
    ["only email_confirmed_at present", { email_confirmed_at: "2026-11-06T10:00:00Z" }, "active"],
    ["only confirmed_at set", { email_confirmed_at: null, confirmed_at: "2026-11-06T10:00:00Z" }, "active"],
    ["only confirmed_at present", { confirmed_at: "2026-11-06T10:00:00Z" }, "active"],
    ["both fields set", { email_confirmed_at: "2026-11-06T10:00:00Z", confirmed_at: "2026-11-06T10:00:00Z" }, "active"],
  ])("classifies %s as %s", (_label, user, expected) => {
    expect(classifyAuthUser(user)).toBe(expected);
  });

  it("accepts a user object with other fields, like the one Auth returns", () => {
    const user = { id: USER_ID, email: "jan@example.com", email_confirmed_at: undefined, invited_at: INVITED_AT };

    expect(classifyAuthUser(user)).toBe("pending");
  });
});

describe("decideInviteAction", () => {
  it.each<[InviteAccountState, InviteAction]>([
    ["none", "invite"],
    ["pending", "reinvite"],
    ["active", "reset_password"],
  ])("answers %s with %s", (state, action) => {
    expect(decideInviteAction(state)).toBe(action);
  });

  it("gives every account state a different action", () => {
    const states: InviteAccountState[] = ["none", "pending", "active"];

    expect(new Set(states.map(decideInviteAction)).size).toBe(3);
  });

  it.each<[string, Parameters<typeof classifyAuthUser>[0], InviteAction]>([
    ["no Auth user: a first invitation", null, "invite"],
    ["an unconfirmed user: a new link", { email_confirmed_at: null }, "reinvite"],
    ["a confirmed user: a password reset", { email_confirmed_at: "2026-11-06T10:00:00Z" }, "reset_password"],
  ])("decides from the Auth user: %s", (_label, user, action) => {
    expect(decideInviteAction(classifyAuthUser(user))).toBe(action);
  });
});

describe("inviteStatus", () => {
  it("is no_account without a linked account", () => {
    expect(status(null, INVITED_AT, null)).toStrictEqual({ kind: "no_account" });
  });

  it("is no_account when the account link is gone but an old invitation date remains", () => {
    expect(status(INVITED_AT, "2026-11-07T10:00:00.000Z", null)).toStrictEqual({ kind: "no_account" });
  });

  it("is no_account for a linked account without an invitation date", () => {
    expect(status(null, "2026-11-07T10:00:00.000Z")).toStrictEqual({ kind: "no_account" });
  });

  it("is no_account when the invitation date cannot be read", () => {
    expect(status("not a date", "2026-11-07T10:00:00.000Z")).toStrictEqual({ kind: "no_account" });
  });

  it("is valid on day 3, with the end 7 days after the invitation", () => {
    expect(status(INVITED_AT, "2026-11-09T10:00:00.000Z")).toStrictEqual({
      kind: "invited",
      invitedAt: INVITED_AT,
      validUntil: VALID_UNTIL,
      expired: false,
    });
  });

  it("is valid right after the invitation", () => {
    expect(status(INVITED_AT, INVITED_AT)).toMatchObject({ kind: "invited", expired: false });
  });

  it("is valid when the clock is slightly behind the invitation", () => {
    expect(status(INVITED_AT, "2026-11-06T09:59:59.000Z")).toMatchObject({ kind: "invited", expired: false });
  });

  it("is still valid exactly 7 days after the invitation", () => {
    expect(status(INVITED_AT, VALID_UNTIL)).toMatchObject({ validUntil: VALID_UNTIL, expired: false });
  });

  it("is still valid one millisecond before the end", () => {
    expect(status(INVITED_AT, "2026-11-13T09:59:59.999Z")).toMatchObject({ expired: false });
  });

  it("has expired one millisecond after the end", () => {
    expect(status(INVITED_AT, "2026-11-13T10:00:00.001Z")).toMatchObject({ expired: true });
  });

  it("has expired 7 days and 1 second after the invitation", () => {
    expect(status(INVITED_AT, "2026-11-13T10:00:01.000Z")).toStrictEqual({
      kind: "invited",
      invitedAt: INVITED_AT,
      validUntil: VALID_UNTIL,
      expired: true,
    });
  });

  it("counts the 7 days over a year boundary and over the end of the daylight saving time", () => {
    expect(status("2026-12-28T23:30:00.000Z", "2027-01-04T23:30:00.000Z")).toMatchObject({
      validUntil: "2027-01-04T23:30:00.000Z",
      expired: false,
    });
    expect(status("2026-10-25T00:30:00.000Z", "2026-11-01T00:30:00.001Z")).toMatchObject({
      validUntil: "2026-11-01T00:30:00.000Z",
      expired: true,
    });
  });

  it("writes both timestamps as UTC ISO, whatever the spelling the database used", () => {
    const expected = { kind: "invited", invitedAt: INVITED_AT, validUntil: VALID_UNTIL, expired: false };

    expect(status("2026-11-06T10:00:00.000000+00:00", INVITED_AT)).toStrictEqual(expected);
    expect(status("2026-11-06T12:00:00+02:00", INVITED_AT)).toStrictEqual(expected);
    expect(status("2026-11-06T10:00:00Z", INVITED_AT)).toStrictEqual(expected);
  });

  it("is active once the account has an activation time", () => {
    expect(status(INVITED_AT, "2026-11-10T10:00:00.000Z", USER_ID, ACTIVATED_AT)).toStrictEqual({
      kind: "active",
      activatedAt: ACTIVATED_AT,
    });
  });

  it("is active although the invitation time is also set, and stays active after the link has expired", () => {
    expect(status(INVITED_AT, "2026-11-09T15:00:00.000Z", USER_ID, ACTIVATED_AT)).toStrictEqual({
      kind: "active",
      activatedAt: ACTIVATED_AT,
    });
    expect(status(INVITED_AT, "2027-06-01T00:00:00.000Z", USER_ID, ACTIVATED_AT)).toStrictEqual({
      kind: "active",
      activatedAt: ACTIVATED_AT,
    });
  });

  it("is active without an invitation time", () => {
    expect(status(null, "2026-11-10T10:00:00.000Z", USER_ID, ACTIVATED_AT)).toStrictEqual({
      kind: "active",
      activatedAt: ACTIVATED_AT,
    });
  });

  it("falls back to the invitation when the activation time cannot be read", () => {
    expect(status(INVITED_AT, "2026-11-09T10:00:00.000Z", USER_ID, "not a date")).toStrictEqual({
      kind: "invited",
      invitedAt: INVITED_AT,
      validUntil: VALID_UNTIL,
      expired: false,
    });
    expect(status(INVITED_AT, "2026-11-09T10:00:00.000Z", USER_ID, "")).toMatchObject({ kind: "invited" });
    expect(status(null, "2026-11-09T10:00:00.000Z", USER_ID, "not a date")).toStrictEqual({ kind: "no_account" });
  });

  it("is no_account for an activation time without a linked account", () => {
    expect(status(INVITED_AT, "2026-11-10T10:00:00.000Z", null, ACTIVATED_AT)).toStrictEqual({ kind: "no_account" });
    expect(status(null, "2026-11-10T10:00:00.000Z", null, ACTIVATED_AT)).toStrictEqual({ kind: "no_account" });
  });

  it("writes the activation time as UTC ISO, whatever the spelling the database used", () => {
    const expected = { kind: "active", activatedAt: ACTIVATED_AT };

    expect(status(null, ACTIVATED_AT, USER_ID, "2026-11-09T14:30:00.000000+00:00")).toStrictEqual(expected);
    expect(status(null, ACTIVATED_AT, USER_ID, "2026-11-09T15:30:00+01:00")).toStrictEqual(expected);
    expect(status(null, ACTIVATED_AT, USER_ID, "2026-11-09T14:30:00Z")).toStrictEqual(expected);
  });

  it("does not depend on the clock for an active account", () => {
    const employee = { userId: USER_ID, invitedAt: INVITED_AT, activatedAt: ACTIVATED_AT };

    expect(inviteStatus(employee, new Date("2000-01-01T00:00:00Z"))).toStrictEqual({
      kind: "active",
      activatedAt: ACTIVATED_AT,
    });
    expect(inviteStatus(employee, new Date("2100-01-01T00:00:00Z"))).toStrictEqual({
      kind: "active",
      activatedAt: ACTIVATED_AT,
    });
  });

  it("gives the same result for repeated calls for an active account", () => {
    const employee = { userId: USER_ID, invitedAt: INVITED_AT, activatedAt: ACTIVATED_AT };
    const now = new Date("2026-11-10T10:00:00.000Z");

    const result = expectDeterministic((at: Date) => inviteStatus(employee, at), now, {
      variants: [new Date(now.getTime()), new Date("2026-11-10T12:00:00+02:00")],
    });

    expect(result).toStrictEqual({ kind: "active", activatedAt: ACTIVATED_AT });
  });

  it("depends on the given time only, not on the clock", () => {
    const employee = { userId: USER_ID, invitedAt: INVITED_AT, activatedAt: null };

    expect(inviteStatus(employee, new Date("2000-01-01T00:00:00Z"))).toMatchObject({ expired: false });
    expect(inviteStatus(employee, new Date("2100-01-01T00:00:00Z"))).toMatchObject({ expired: true });
  });

  it("gives the same result for repeated calls and for equal instants", () => {
    const employee = { userId: USER_ID, invitedAt: INVITED_AT, activatedAt: null };
    const now = new Date("2026-11-09T10:00:00.000Z");
    const variants = [new Date(now.getTime()), new Date("2026-11-09T12:00:00+02:00")];

    const result = expectDeterministic((at: Date) => inviteStatus(employee, at), now, { variants });

    expect(result).toStrictEqual({ kind: "invited", invitedAt: INVITED_AT, validUntil: VALID_UNTIL, expired: false });
  });

  it("does not change the employee or the time it is given", () => {
    const employee = { userId: USER_ID, invitedAt: INVITED_AT, activatedAt: ACTIVATED_AT };
    const now = new Date("2026-11-09T10:00:00.000Z");

    inviteStatus(employee, now);

    expect(employee).toStrictEqual({ userId: USER_ID, invitedAt: INVITED_AT, activatedAt: ACTIVATED_AT });
    expect(now.toISOString()).toBe("2026-11-09T10:00:00.000Z");
  });
});

describe("formatInviteLabel", () => {
  it("labels an employee without an account", () => {
    expect(formatInviteLabel({ kind: "no_account" })).toBe("Bez konta");
  });

  it("labels an invitation whose link still works", () => {
    expect(formatInviteLabel(status(INVITED_AT, "2026-11-09T10:00:00.000Z"))).toBe(
      "Zaproszony 06.11.2026 (link ważny do 13.11.2026)",
    );
  });

  it("labels an invitation whose link has expired by the link only, not by the invitation or the account", () => {
    expect(formatInviteLabel(status(INVITED_AT, "2026-11-13T10:00:01.000Z"))).toBe(
      "Zaproszony 06.11.2026 (link wygasł 13.11.2026)",
    );
  });

  it("labels the last moment of the link as still valid", () => {
    expect(formatInviteLabel(status(INVITED_AT, VALID_UNTIL))).toContain("link ważny do 13.11.2026");
  });

  it("pads the day and the month with zeros", () => {
    expect(formatInviteLabel(status("2026-01-03T08:00:00.000Z", "2026-01-04T08:00:00.000Z"))).toBe(
      "Zaproszony 03.01.2026 (link ważny do 10.01.2026)",
    );
  });

  it("writes the dates in UTC, whatever the offset of the stored timestamp", () => {
    // 23:30 at UTC-5 is already the next day in UTC.
    expect(formatInviteLabel(status("2026-11-06T23:30:00-05:00", "2026-11-07T10:00:00.000Z"))).toBe(
      "Zaproszony 07.11.2026 (link ważny do 14.11.2026)",
    );
    expect(formatInviteLabel(status("2026-11-06T23:59:59.999Z", "2026-11-07T10:00:00.000Z"))).toBe(
      "Zaproszony 06.11.2026 (link ważny do 13.11.2026)",
    );
  });

  it("carries the 7 days over a month and a year", () => {
    expect(formatInviteLabel(status("2026-12-28T10:00:00.000Z", "2026-12-29T10:00:00.000Z"))).toBe(
      "Zaproszony 28.12.2026 (link ważny do 04.01.2027)",
    );
  });

  it("labels an active account by its registration date", () => {
    expect(formatInviteLabel({ kind: "active", activatedAt: ACTIVATED_AT })).toBe("Zarejestrowany 09.11.2026");
  });

  it("labels an active account by the registration date only, also when the invitation link has expired", () => {
    const active = status(INVITED_AT, "2026-11-20T10:00:00.000Z", USER_ID, ACTIVATED_AT);

    expect(formatInviteLabel(active)).toBe("Zarejestrowany 09.11.2026");
    expect(formatInviteLabel(active)).not.toContain("Zaproszony");
    expect(formatInviteLabel(active)).not.toContain("link");
  });

  it("pads the registration day and month with zeros and writes them in UTC", () => {
    expect(formatInviteLabel({ kind: "active", activatedAt: "2026-01-03T08:00:00.000Z" })).toBe(
      "Zarejestrowany 03.01.2026",
    );
    // 23:30 at UTC-5 is already the next day in UTC.
    expect(formatInviteLabel(status(null, ACTIVATED_AT, USER_ID, "2026-11-09T23:30:00-05:00"))).toBe(
      "Zarejestrowany 10.11.2026",
    );
  });

  it("gives the same label for repeated calls", () => {
    const current = status(INVITED_AT, "2026-11-09T10:00:00.000Z");

    expect(expectDeterministic(formatInviteLabel, current)).toBe("Zaproszony 06.11.2026 (link ważny do 13.11.2026)");
  });

  it("gives the same label for repeated calls for an active account", () => {
    const current = status(INVITED_AT, "2026-11-10T10:00:00.000Z", USER_ID, ACTIVATED_AT);

    expect(expectDeterministic(formatInviteLabel, current)).toBe("Zarejestrowany 09.11.2026");
  });
});

describe("emailChangeBlocked", () => {
  it.each<[string, string | null, string | null]>([
    ["the same address", "jan@example.com", "jan@example.com"],
    ["a new address", "jan@example.com", "anna@example.com"],
    ["clearing the address", "jan@example.com", null],
    ["setting an address", null, "jan@example.com"],
    ["no address on either side", null, null],
  ])("never blocks without an account: %s", (_label, current, next) => {
    expect(emailChangeBlocked({ userId: null, email: current }, next)).toBe(false);
  });

  it("allows the same address with an account", () => {
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "jan@example.com")).toBe(false);
  });

  it("allows the same address in other letter case or with outer spaces", () => {
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "Jan@Example.COM")).toBe(false);
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "  jan@example.com ")).toBe(false);
    expect(emailChangeBlocked({ userId: USER_ID, email: "Jan@Example.com" }, "jan@example.com")).toBe(false);
  });

  it("blocks a different address with an account", () => {
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "anna@example.com")).toBe(true);
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "jan@example.org")).toBe(true);
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "jan2@example.com")).toBe(true);
  });

  it("blocks clearing the address with an account", () => {
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, null)).toBe(true);
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "")).toBe(true);
    expect(emailChangeBlocked({ userId: USER_ID, email: "jan@example.com" }, "   ")).toBe(true);
  });

  it("treats an empty address like none", () => {
    expect(emailChangeBlocked({ userId: USER_ID, email: null }, null)).toBe(false);
    expect(emailChangeBlocked({ userId: USER_ID, email: null }, "")).toBe(false);
    expect(emailChangeBlocked({ userId: USER_ID, email: "" }, null)).toBe(false);
    expect(emailChangeBlocked({ userId: USER_ID, email: null }, "jan@example.com")).toBe(true);
  });

  it("gives the same answer for repeated calls", () => {
    const input = { existing: { userId: USER_ID, email: "jan@example.com" }, next: "anna@example.com" };

    expect(expectDeterministic(({ existing, next }) => emailChangeBlocked(existing, next), input)).toBe(true);
  });
});

describe("parseSetPasswordLink", () => {
  const HASH = "0b5e2d6e7c1a4f8e9a532d1f6c3b8e900b5e2d6e7c1a4f8e9a532d1f";

  it.each<[string, unknown, unknown, ReturnType<typeof parseSetPasswordLink>]>([
    ["an invite link", HASH, "invite", { tokenHash: HASH, type: "invite" }],
    ["a recovery link", HASH, "recovery", { tokenHash: HASH, type: "recovery" }],
    ["a hash with the PKCE prefix", `pkce_${HASH}`, "recovery", { tokenHash: `pkce_${HASH}`, type: "recovery" }],
    ["a one character hash", "a", "invite", { tokenHash: "a", type: "invite" }],
    ["a hash of 200 characters", "a".repeat(200), "invite", { tokenHash: "a".repeat(200), type: "invite" }],
  ])("accepts %s", (_label, tokenHash, type, expected) => {
    expect(parseSetPasswordLink(tokenHash, type)).toStrictEqual(expected);
  });

  it.each<[string, unknown, unknown]>([
    ["a missing hash", undefined, "invite"],
    ["a null hash", null, "invite"],
    ["an empty hash", "", "invite"],
    ["a hash of 201 characters", "a".repeat(201), "invite"],
    ["a hash with a space", "abc def", "invite"],
    ["a hash with a quote", 'abc"def', "invite"],
    ["a hash with a slash", "abc/def", "invite"],
    ["a hash with a line break", "abc\n", "invite"],
    ["a number as the hash", 12345, "invite"],
    ["an array as the hash", [HASH], "invite"],
    ["a missing type", HASH, undefined],
    ["a null type", HASH, null],
    ["an empty type", HASH, ""],
    ["an unknown type", HASH, "magiclink"],
    ["the type signup", HASH, "signup"],
    ["a type in other letter case", HASH, "Invite"],
    ["a type with a space", HASH, "invite "],
    ["an array as the type", HASH, ["invite"]],
  ])("rejects %s", (_label, tokenHash, type) => {
    expect(parseSetPasswordLink(tokenHash, type)).toBeNull();
  });

  it("gives the same answer for repeated calls", () => {
    const input = { tokenHash: HASH, type: "invite" };

    expect(expectDeterministic(({ tokenHash, type }) => parseSetPasswordLink(tokenHash, type), input)).toStrictEqual(
      input,
    );
  });
});

describe("the e-mail lock message", () => {
  it("names the cause the planner can act on", () => {
    expect(EMAIL_LOCKED_MESSAGE).toBe("E-mail jest zablokowany po zaproszeniu konta");
  });
});

describe("decideInviteAction repeatability", () => {
  it.each<InviteAccountState>(["none", "pending", "active"])("gives the same action for %s every time", (state) => {
    expectDeterministic(decideInviteAction, state);
  });
});
