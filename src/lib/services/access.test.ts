import { describe, expect, it } from "vitest";
import { decideAccess, parseRole, type AccessDecision } from "@/lib/services/access";
import { expectDeterministic } from "@/lib/testing/determinism";
import type { Role } from "@/types";

interface Actor {
  signedIn: boolean;
  role: Role | null;
}

const actors = {
  anonymous: { signedIn: false, role: null },
  "signed in without a role": { signedIn: true, role: null },
  employee: { signedIn: true, role: "employee" },
  planner: { signedIn: true, role: "planner" },
} satisfies Record<string, Actor>;
type ActorName = keyof typeof actors;
const actorNames = Object.keys(actors) as ActorName[];

const allowed: AccessDecision = { allowed: true };
const unauthenticated: AccessDecision = { allowed: false, reason: "unauthenticated" };
const forbidden: AccessDecision = { allowed: false, reason: "forbidden" };

function access(pathname: string, actor: ActorName): AccessDecision {
  return decideAccess({ pathname, ...actors[actor] });
}

// The planner-only outcome per actor: anonymous is asked to sign in, everyone but the planner is turned away.
function expectPlannerOnly(pathname: string) {
  expect(access(pathname, "anonymous")).toStrictEqual(unauthenticated);
  expect(access(pathname, "signed in without a role")).toStrictEqual(forbidden);
  expect(access(pathname, "employee")).toStrictEqual(forbidden);
  expect(access(pathname, "planner")).toStrictEqual(allowed);
}

const layers: Record<string, { paths: string[]; outcomes: Record<ActorName, AccessDecision> }> = {
  public: {
    paths: ["/", "/auth/signin", "/api/auth/signin", "/api/auth/signout", "/access-denied"],
    outcomes: { anonymous: allowed, "signed in without a role": allowed, employee: allowed, planner: allowed },
  },
  "any-role": {
    paths: ["/dashboard"],
    outcomes: {
      anonymous: unauthenticated,
      "signed in without a role": forbidden,
      employee: allowed,
      planner: allowed,
    },
  },
  "planner-only": {
    paths: ["/employees", "/some/unlisted/page"],
    outcomes: {
      anonymous: unauthenticated,
      "signed in without a role": forbidden,
      employee: forbidden,
      planner: allowed,
    },
  },
};

describe("decideAccess layer matrix", () => {
  const cases = Object.entries(layers).flatMap(([layer, { paths, outcomes }]) =>
    paths.flatMap((pathname) => actorNames.map((actor) => ({ layer, pathname, actor, expected: outcomes[actor] }))),
  );

  it.each(cases)("$layer $pathname as $actor", ({ pathname, actor, expected }) => {
    expect(access(pathname, actor)).toStrictEqual(expected);
  });

  it("ignores a role when the user is not signed in", () => {
    expect(decideAccess({ pathname: "/dashboard", signedIn: false, role: "planner" })).toStrictEqual(unauthenticated);
    expect(decideAccess({ pathname: "/employees", signedIn: false, role: "planner" })).toStrictEqual(unauthenticated);
    expect(decideAccess({ pathname: "/auth/signin", signedIn: false, role: "planner" })).toStrictEqual(allowed);
  });

  it("gives the same result on repeated calls", () => {
    for (const pathname of ["/", "/dashboard", "/employees", "/dashboard/x"]) {
      for (const actor of actorNames) {
        expectDeterministic(decideAccess, { pathname, ...actors[actor] });
      }
    }
  });
});

describe("decideAccess trailing slash", () => {
  it.each(["/auth/signin", "/api/auth/signout", "/access-denied", "/dashboard", "/employees"])(
    "%s accepts a single trailing slash and decides the same",
    (pathname) => {
      for (const actor of actorNames) {
        const input = { pathname, ...actors[actor] };
        expectDeterministic(decideAccess, input, { variants: [{ ...input, pathname: `${pathname}/` }] });
      }
    },
  );

  it("keeps the root public and does not turn it into an empty path", () => {
    for (const actor of actorNames) {
      expect(access("/", actor)).toStrictEqual(allowed);
    }
  });
});

// Each group lists spellings that must NOT reach a public or any-role entry; they fall into planner-only instead.
const lookalikes: Record<string, string[]> = {
  "a different letter case": [
    "/Dashboard",
    "/DASHBOARD",
    "/Auth/signin",
    "/auth/Signin",
    "/API/auth/signout",
    "/Access-Denied",
  ],
  "a longer last segment": ["/dashboardx", "/auth/signin2", "/api/auth/signout-all", "/access-deniedx"],
  "an extra segment": ["/dashboard/x", "/auth/signin/extra", "/api/auth/signin/x", "/access-denied/x"],
  "a percent sign": ["/%64ashboard", "/dashboard%2F", "/dashboard%2f", "/auth/%73ignin", "/dashboard%00"],
  "a backslash": ["/a\\b", "/auth\\signin", "/dashboard\\", "/api\\auth\\signout"],
  "an empty segment": ["//dashboard", "/auth//signin", "/dashboard//", "/auth/signin//", "//", "///"],
  "a dot segment": [
    "/auth/signin/../../planner",
    "/dashboard/..",
    "/dashboard/../auth/signin",
    "/auth/../dashboard",
    "/./dashboard",
    "/dashboard/.",
    "/dashboard/./",
    "/auth/signin/..",
    "/.",
    "/..",
  ],
  "a control character": [
    "/dashboard\n",
    "/dashboard\t",
    "/dashboard\r",
    "/dashboard\u0000",
    "/dashboard\u007f",
    "/dashboard\u0085",
    "/auth/signin\n",
    "/\u0000",
  ],
  "surrounding whitespace": ["/dashboard ", " /dashboard", "/ dashboard", "/auth/signin "],
  "no leading slash": ["dashboard", "auth/signin", "api/auth/signout", "access-denied", "", " "],
  "an inherited object key": ["/constructor", "/__proto__", "/toString", "/hasOwnProperty", "constructor", "__proto__"],
};

describe("decideAccess path hygiene", () => {
  describe.each(Object.entries(lookalikes))("a path with %s", (_group, paths) => {
    it.each(paths)("%j never gets public or shared access", (pathname) => {
      expectPlannerOnly(pathname);
    });
  });
});

describe("decideAccess default deny", () => {
  it.each([
    "/employees",
    "/favicon.ico",
    "/robots.txt",
    "/_image",
    "/_server-islands/Example",
    "/api/unlisted",
    "/some/unlisted/page",
  ])("%s is planner-only", (pathname) => {
    expectPlannerOnly(pathname);
  });
});

describe("parseRole", () => {
  it.each(["planner", "employee"] as const)("accepts %s", (role) => {
    expect(parseRole(role)).toBe(role);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a different letter case", "Planner"],
    ["upper case", "PLANNER"],
    ["a capitalised employee", "Employee"],
    ["a leading space", " planner"],
    ["a trailing space", "planner "],
    ["a trailing newline", "employee\n"],
    ["an unknown role", "admin"],
    ["zero", 0],
    ["a number", 1],
    ["NaN", NaN],
    ["true", true],
    ["an empty array", []],
    ["an array holding a role", ["planner"]],
    ["an empty object", {}],
    ["an object holding a role", { role: "planner" }],
    ["an object that stringifies to a role", { toString: () => "planner" }],
  ])("rejects %s", (_label, value) => {
    expect(parseRole(value)).toBeNull();
  });
});

describe("an unrecognised role", () => {
  it.each<[string, unknown]>([
    ["admin", "admin"],
    ["Planner", "Planner"],
    ["PLANNER", "PLANNER"],
    ["a missing value", undefined],
    ["null", null],
  ])("%s is treated like no role: forbidden outside the public layer", (_label, raw) => {
    const role = parseRole(raw);

    expect(role).toBeNull();
    expect(decideAccess({ pathname: "/dashboard", signedIn: true, role })).toStrictEqual(forbidden);
    expect(decideAccess({ pathname: "/employees", signedIn: true, role })).toStrictEqual(forbidden);
    expect(decideAccess({ pathname: "/auth/signin", signedIn: true, role })).toStrictEqual(allowed);
    expect(decideAccess({ pathname: "/", signedIn: true, role })).toStrictEqual(allowed);
  });
});
