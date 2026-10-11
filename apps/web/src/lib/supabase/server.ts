import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client (anon key + the caller's session cookie —
 * NOT the service-role key, see service.ts for that). Reads cookies(),
 * so per docs/adr/001-nextjs-cache-components.md every caller of this
 * function must itself be inside a <Suspense> boundary, not at a layout's
 * top level. This is the one place session cookies are read in the whole
 * app — see lib/auth.ts's getCurrentUser() for the Data Access Layer
 * entry point that wraps it with "use cache: private".
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component (not a Server Action
            // or Route Handler) — cookies() is read-only there. Safe to
            // ignore as long as middleware.ts is also refreshing the
            // session, which it is.
          }
        },
      },
    }
  );
}
