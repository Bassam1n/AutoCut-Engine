import { Suspense } from "react";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { getActivePromptsByTask, EDITABLE_TASKS } from "./prompts-data";
import { PromptEditorList } from "./prompt-editor";

export default function PromptsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <Link
          href="/platform-admin"
          className="inline-flex items-center gap-1 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
        >
          <span aria-hidden="true">←</span> Back
        </Link>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Platform admin
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Agent prompts</h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Edits save as a new version and take effect immediately for every
          org — the previous version stays in history and is never deleted.
        </p>
      </div>

      <Suspense fallback={<Skeleton />}>
        <GatedEditor />
      </Suspense>
    </main>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-border" />
      ))}
    </div>
  );
}

async function GatedEditor() {
  await requirePlatformAdmin();
  const activeByTask = await getActivePromptsByTask();
  return <PromptEditorList tasks={EDITABLE_TASKS} activeByTask={activeByTask} />;
}
