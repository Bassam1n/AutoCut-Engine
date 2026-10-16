import data from "./tutorials.json";
import type { OrgRole } from "@/lib/roles";

/**
 * Interactive tutorials: screenshots of the demo agency with a hotspot
 * on what to click or look at. Captured by tools/tutorials/capture.mjs;
 * re-run it when the UI changes. No "server-only": the player is a
 * client component.
 */
export type TutorialStep = {
  image: string;
  /** Hotspot as fractions of the screenshot (0 to 1). */
  box: { x: number; y: number; w: number; h: number } | null;
  title: string;
  body: string;
  /** The viewer continues by clicking the hotspot. */
  click: boolean;
};

export type Tutorial = {
  id: string;
  title: string;
  description: string;
  category: string;
  roles: OrgRole[];
  minutes: number;
  /** "/org/{org}/..." to open the real screen afterwards. */
  appPath: string | null;
  steps: TutorialStep[];
};

export const TUTORIALS = data.tutorials as Tutorial[];
export const TUTORIAL_CATEGORIES = [...new Set(TUTORIALS.map((t) => t.category))];
export const FIRST_TUTORIAL_ID = "workspace-tour";

export function tutorialsForRole(role: OrgRole | null): Tutorial[] {
  return TUTORIALS.filter((t) => (role ? t.roles.includes(role) : t.roles.includes("editor")));
}
