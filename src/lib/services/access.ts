import type { Role } from "@/types";

export type AccessDenial = "unauthenticated" | "forbidden";
export type AccessDecision = { allowed: true } | { allowed: false; reason: AccessDenial };

type OpenLayer = "public" | "any-role";

// Single source of truth for who may open which path. Every path not listed here is planner-only (default deny), so a
// new route stays closed until it is added on purpose. An object literal makes a duplicate key a compile error.
const OPEN_PATHS: Readonly<Record<string, OpenLayer>> = {
  "/": "public",
  "/auth/signin": "public",
  "/api/auth/signin": "public",
  "/api/auth/signout": "public",
  "/access-denied": "public",
  "/dashboard": "any-role",
};

// A Map, not property access on the object, so an inherited key such as __proto__ can never match.
const OPEN_LAYER_BY_PATH: ReadonlyMap<string, OpenLayer> = new Map(Object.entries(OPEN_PATHS));

// No table path contains these, so a path that does is never "fixed up" (decoded, unescaped) into a table path.
const UNSAFE_CHARS = /[%\\\p{Cc}]/u;

/** The open layer a path belongs to, or undefined when it is planner-only. Matching is exact and case-sensitive. */
function findOpenLayer(pathname: string): OpenLayer | undefined {
  if (!pathname.startsWith("/") || UNSAFE_CHARS.test(pathname) || pathname.includes("//")) {
    return undefined;
  }
  if (pathname.split("/").some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }
  // Checked on the original string above, so only one trailing slash can be left to drop here (never from "/").
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return OPEN_LAYER_BY_PATH.get(normalized);
}

/** Returns the role only for the exact strings "planner" and "employee"; anything else is not a role. */
export function parseRole(value: unknown): Role | null {
  return value === "planner" || value === "employee" ? value : null;
}

/** Decides whether a request may open `pathname`. A role is only considered for signed-in users. */
export function decideAccess(input: { pathname: string; signedIn: boolean; role: Role | null }): AccessDecision {
  const layer = findOpenLayer(input.pathname);
  if (layer === "public") {
    return { allowed: true };
  }
  if (!input.signedIn) {
    return { allowed: false, reason: "unauthenticated" };
  }
  if (input.role === "planner" || (input.role === "employee" && layer === "any-role")) {
    return { allowed: true };
  }
  return { allowed: false, reason: "forbidden" };
}
