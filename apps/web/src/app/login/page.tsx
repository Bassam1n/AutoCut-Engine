import { Suspense } from "react";
import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image src="/logo-mark.png" alt="ACE" width={360} height={144} priority className="mx-auto mb-4 h-12 w-auto" />
          <h1 className="text-xl font-semibold tracking-tight">
            Sign in to AutoCut Engine
          </h1>
          <p className="mt-1.5 text-sm text-foreground-muted">
            We&apos;ll email you a one-time sign-in link.
          </p>
        </div>

        <div className="card p-6">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
