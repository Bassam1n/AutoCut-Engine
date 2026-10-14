import { Suspense } from "react";
import Image from "next/image";
import { AcceptForm } from "./accept-form";

/**
 * Landing page for shared sign-in links (WhatsApp, email, anywhere).
 * The link carries a token HASH; nothing is consumed by loading this
 * page, so link-preview bots and email scanners can fetch it freely.
 * The one-time token is only spent when the person presses Continue.
 */
export default function AcceptPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Image src="/logo-mark.png" alt="ACE" width={360} height={144} priority className="mx-auto mb-4 h-12 w-auto" />
        <h1 className="text-xl font-semibold tracking-tight">Sign in to AutoCut Engine</h1>
        <div className="card mt-6 p-6">
          <Suspense>
            <AcceptForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
