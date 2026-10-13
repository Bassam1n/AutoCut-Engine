"use client";

import { useSyncExternalStore } from "react";

/**
 * Light / Dark / System switch. An explicit choice is stored in
 * localStorage and mirrored onto <html data-theme>, which globals.css
 * keys the dark tokens off; "system" removes both so the OS
 * prefers-color-scheme setting applies again. themeInitScript (run in
 * the root layout's <head>) applies the stored choice before first
 * paint so a dark-mode user never sees a light flash.
 */
type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "autocut-theme";
const CHANGE_EVENT = "autocut-theme-change";

export const themeInitScript = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  // Keeps other open tabs in sync when the choice changes in one of them.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function applyPref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage blocked (private mode etc.): the choice still applies to this page view.
  }
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as const);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center rounded-full border border-border bg-background-raised p-0.5"
    >
      {OPTIONS.map((option) => {
        const isActive = pref === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => applyPref(option.value)}
            className={`flex-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              isActive
                ? "bg-accent-soft text-accent shadow-[var(--shadow-soft)]"
                : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
