import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { signOut } from "./actions";

export default function HomePage() {
  return (
    <main>
      {/* Static shell: no session read here, prerenders instantly. */}
      <h1>AutoCut Engine</h1>

      {/* Reads the session, so this streams in behind the boundary —
          per ADR 001, never at the layout/page top level. */}
      <Suspense fallback={<p>Loading your account…</p>}>
        <AccountBadge />
      </Suspense>
    </main>
  );
}

async function AccountBadge() {
  const user = await getCurrentUser();

  return (
    <div>
      <p>Signed in as {user.email}</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
