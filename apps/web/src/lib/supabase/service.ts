import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. BYPASSES RLS ENTIRELY — this is not a
 * per-user client, it has unrestricted read/write access to every org's
 * data. Per spec §4: "The service-role key never ships to the browser."
 *
 * The `server-only` import above makes any accidental import of this file
 * from a Client Component a BUILD ERROR, not just a runtime mistake.
 *
 * Legitimate callers: webhook handlers verifying a provider signature
 * before writing a job result, and (starting M9) the workflow engine's
 * own step functions. Server Actions and page code that act on behalf of
 * a signed-in user should use lib/supabase/server.ts instead, so RLS
 * still applies and a bug can't silently cross an org boundary.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createServiceClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set"
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
