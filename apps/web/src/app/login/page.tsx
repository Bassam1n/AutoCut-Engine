import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-ink">
            AC
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Sign in to AutoCut Engine
          </h1>
          <p className="mt-1.5 text-sm text-foreground-muted">
            We&apos;ll email you a one-time sign-in link.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background-raised p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
