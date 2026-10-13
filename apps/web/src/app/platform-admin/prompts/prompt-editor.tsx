"use client";

import { useEffect, useState, useTransition } from "react";
import { savePromptVersion, fetchPromptHistory } from "./prompts-actions";
import { LoadingIndicator } from "@/components/loading-indicator";
import type { PromptVersionRow } from "./prompts-data";

const TASK_LABELS: Record<string, string> = {
  example_extraction: "Extraction (M4 sample task)",
  generate_ad_scripts: "Scripts",
  generate_scene_plan: "Scene plan",
  generate_concepts: "Concept pitch",
  extract_cast: "Cast extraction",
  generate_scene_visuals: "Storyboard / Visual Director",
};

export function PromptEditorList({
  tasks,
  activeByTask,
}: {
  tasks: readonly string[];
  activeByTask: Record<string, PromptVersionRow>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {tasks.map((task) => (
        <PromptEditorCard key={task} task={task} active={activeByTask[task] ?? null} />
      ))}
    </div>
  );
}

function PromptEditorCard({ task, active }: { task: string; active: PromptVersionRow | null }) {
  const [body, setBody] = useState(active?.body ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const isDirty = body !== (active?.body ?? "");

  function onSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await savePromptVersion(task, body);
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="card-inset flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{TASK_LABELS[task] ?? task}</p>
          <p className="text-xs text-foreground-muted">
            task: {task}
            {active && <span className="ml-2">— active version {active.version}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="text-xs font-medium text-foreground-muted hover:underline"
        >
          {showHistory ? "Hide history" : "History"}
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSaved(false);
        }}
        rows={6}
        disabled={isPending}
        className="field resize-y"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || !isDirty}
          className="btn-primary btn-sm self-start"
        >
          {isPending ? <LoadingIndicator label="Saving..." /> : "Save as new version"}
        </button>
        {saved && <span className="text-xs font-medium text-accent">Saved ✓</span>}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}

      {showHistory && <PromptHistory task={task} />}
    </div>
  );
}

function PromptHistory({ task }: { task: string }) {
  const [history, setHistory] = useState<PromptVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPromptHistory(task)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load history.");
      });
    return () => {
      cancelled = true;
    };
  }, [task]);

  if (error) return <p className="text-xs text-danger">{error}</p>;
  if (!history) return <p className="text-xs text-foreground-muted">Loading history...</p>;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {history.map((row) => (
        <div key={row.id} className="rounded-lg bg-border/20 p-2 text-xs">
          <p className="font-medium text-foreground-muted">
            v{row.version} {row.active && "(active)"} — {new Date(row.created_at).toLocaleString()}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-foreground-muted">{row.body}</p>
        </div>
      ))}
    </div>
  );
}
