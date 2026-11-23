import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

/**
 * A client with the service-role key: it bypasses row-level security and may use the Auth admin API. Only the invitation
 * route (`src/pages/api/employees/[id]/invite.ts`) may import this module; ESLint enforces it. Null when the URL or the
 * key is not configured.
 */
export function createAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  // No session of its own: the key is the credential, and a Worker keeps nothing between requests.
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
