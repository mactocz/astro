import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { decideAccess, parseRole } from "@/lib/services/access";

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }
  // Only app_metadata may grant a role: user_metadata is writable by the user.
  context.locals.role = parseRole(context.locals.user?.app_metadata.role);

  const decision = decideAccess({
    pathname: context.url.pathname,
    signedIn: context.locals.user !== null,
    role: context.locals.role,
  });
  if (decision.allowed) {
    return next();
  }

  if (context.url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: decision.reason }), {
      status: decision.reason === "unauthenticated" ? 401 : 403,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  // next(path), not context.rewrite(): a rewrite re-runs this middleware on the shared locals and calls getUser() twice.
  return next("/access-denied");
});
