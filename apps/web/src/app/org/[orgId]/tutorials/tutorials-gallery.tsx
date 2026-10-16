"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Tutorial } from "@/lib/tutorials";
import { TutorialPlayer, readDone } from "./tutorial-player";

export function TutorialsGallery({ orgId, tutorials }: { orgId: string; tutorials: Tutorial[] }) {
  const searchParams = useSearchParams();
  // Local state, mirrored into ?play= without a server round trip, so
  // the player opens instantly and the URL can still be shared.
  const [playing, setPlaying] = useState<string | null>(searchParams.get("play"));
  const categories = ["All", ...new Set(tutorials.map((t) => t.category))];
  const [category, setCategory] = useState("All");
  const [done, setDone] = useState<Set<string>>(new Set());

  // Completion lives in this browser only; read it after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDone(readDone()), [playing]);

  function open(id: string | null) {
    setPlaying(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("play", id);
    else url.searchParams.delete("play");
    window.history.replaceState(window.history.state, "", url);
  }

  const current = tutorials.find((t) => t.id === playing) ?? null;
  const currentIndex = current ? tutorials.indexOf(current) : -1;
  const nextTutorial = currentIndex >= 0 ? (tutorials[currentIndex + 1] ?? null) : null;
  const shown = category === "All" ? tutorials : tutorials.filter((t) => t.category === category);
  const groups = (category === "All" ? categories.slice(1) : [category]).map((c) => ({
    name: c,
    items: shown.filter((t) => t.category === c),
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tutorial categories">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              category === c ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-border/40"
            }`}
          >
            {c}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-foreground-muted">
          {done.size} of {tutorials.length} completed
        </span>
      </div>

      {groups.map((g) => (
        <section key={g.name} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight">{g.name}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => open(t.id)}
                className="card card-interactive group flex flex-col overflow-hidden text-left"
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={t.steps[0]?.image}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover object-left-top transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg">
                      {done.has(t.id) ? "Watch again" : "Get started"}
                    </span>
                  </span>
                  {done.has(t.id) && (
                    <span className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">
                      ✓ Done
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-sm text-foreground-muted">{t.description}</p>
                  <p className="mt-auto pt-2 text-xs text-foreground-muted">
                    {t.steps.length} steps · about {t.minutes} min
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {current && (
        <TutorialPlayer
          key={current.id}
          orgId={orgId}
          tutorial={current}
          nextTutorial={nextTutorial}
          onClose={() => open(null)}
          onOpenTutorial={open}
        />
      )}
    </div>
  );
}
