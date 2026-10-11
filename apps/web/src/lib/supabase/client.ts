import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Uses the anon key — RLS is the only
 * thing standing between this client and another org's data, per
 * docs/HERMES_WEB_SPEC_V2.md §2 rule 6 and the pgTAP suite in
 * supabase/tests/.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
