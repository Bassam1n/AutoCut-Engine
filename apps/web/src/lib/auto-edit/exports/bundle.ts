import { cuesToSrt } from "@/lib/captions/srt";
import type { EditPlan } from "../plan-schema";
import { transitionLabel } from "../transitions";
import { fcp7Xml } from "./fcp7";
import { fcpxml } from "./fcpxml";
import { otioJson } from "./otio";
import { FPS, buildExportTimeline, timecode, type ExportMedia, type ExportTimeline } from "./timeline";

/**
 * "Export project for..." without any Claude cost: the saved plan as a
 * project another editor opens, with its media alongside. This file
 * writes the text files; the worker adds the media (scene clips,
 * voiceover, graphics rendered as ProRes 4444 overlay clips) and, for
 * Concat, a project built through Concat's own API.
 */

export const EXPORT_FORMATS = ["concat", "premiere", "resolve", "fcp", "capcut"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_LABEL: Record<ExportFormat, string> = {
  concat: "Concat",
  premiere: "Premiere Pro",
  resolve: "DaVinci Resolve",
  fcp: "Final Cut Pro",
  capcut: "CapCut",
};

export type TextFile = { path: string; content: string };

/** For CapCut: each shot cut out of its scene clip, numbered in timeline order. */
export type CapcutCut = { out: string; source: string; fromSeconds: number; toSeconds: number };

export type ExportText = { files: TextFile[]; notes: string[]; capcutCuts: CapcutCut[] };

export function srt(t: ExportTimeline): string {
  return cuesToSrt(t.captions.map((c, i) => ({ index: i + 1, startS: c.start / FPS, endS: c.end / FPS, text: c.text })));
}

export function exportText(format: ExportFormat, plan: EditPlan, media: ExportMedia, name: string): ExportText {
  const t = buildExportTimeline(plan, media, name);
  const files: TextFile[] = [];
  const notes: string[] = [];
  const capcutCuts: CapcutCut[] = [];
  if (t.captions.length) files.push({ path: "captions.srt", content: srt(t) });

  const swapped = [...new Set(t.video.flatMap((c) => (c.transitionType && c.transitionType !== "cross-fade" ? [transitionLabel(c.transitionType)] : [])))];
  const transitionsNote = swapped.length
    ? `${EXPORT_LABEL[format]} doesn't have AutoCut's ${swapped.join(", ")} transition${swapped.length > 1 ? "s" : ""}, so ${swapped.length > 1 ? "they come" : "it comes"} in as cross dissolves of the same length at the same cuts.`
    : null;
  const hasPans = t.video.some((c) => c.motion.some((k) => k.offsetX !== 0 || k.offsetY !== 0));
  const graphicsNote = "Motion graphics are rendered clips (ProRes 4444 with transparency for overlays, H.264 for full-frame cards), so their animation can't be edited, only moved and trimmed.";
  const captionsNote = "Captions are in captions.srt; import it as a caption track. Their on-screen style is not carried over.";

  switch (format) {
    case "premiere":
      files.push({ path: `${name}.xml`, content: fcp7Xml(t) });
      notes.push("Open with File > Import and pick the .xml; keep it next to the media folder.", captionsNote, graphicsNote);
      notes.push("Ken Burns moves come across as Basic Motion scale and position keyframes; check the framing on clips with a move.");
      if (transitionsNote) notes.push(transitionsNote);
      break;
    case "resolve":
      files.push({ path: `${name}.fcpxml`, content: fcpxml(t) }, { path: `${name}.otio`, content: otioJson(t) });
      notes.push("Import the .fcpxml (File > Import > Timeline); the .otio is the same timeline in OpenTimelineIO form, without the zoom keyframes.", captionsNote, graphicsNote);
      if (hasPans) notes.push("Zoom keyframes come across; side-to-side and up-down pans don't, so pan clips start centred.");
      if (transitionsNote) notes.push(transitionsNote);
      break;
    case "fcp":
      files.push({ path: `${name}.fcpxml`, content: fcpxml(t) });
      notes.push("Open with File > Import > XML and pick the .fcpxml; keep it next to the media folder.", captionsNote, graphicsNote);
      if (hasPans) notes.push("Zoom keyframes come across; side-to-side and up-down pans don't, so pan clips start centred.");
      if (transitionsNote) notes.push(transitionsNote);
      break;
    case "capcut": {
      const lines: string[] = [];
      t.video.forEach((c, i) => {
        const out = `media/${String(i + 1).padStart(3, "0")} ${c.name}.mp4`;
        capcutCuts.push({ out, source: c.file, fromSeconds: c.in / FPS, toSeconds: c.out / FPS });
        lines.push(`${String(i + 1).padStart(3, "0")}  ${timecode(c.start)}  ${((c.end - c.start) / FPS).toFixed(2)}s  ${c.name}${c.transitionType ? `  (${transitionLabel(c.transitionType).toLowerCase()} in, ${(c.transitionIn / FPS).toFixed(2)}s)` : ""}`);
      });
      t.overlays.forEach((o, i) => lines.push(`G${String(i + 1).padStart(2, "0")}  ${timecode(o.start)}  ${((o.end - o.start) / FPS).toFixed(2)}s  graphic ${o.name} (${o.layout === "overlay" ? "overlay track" : "full frame"})`));
      t.voiceover.forEach((v) => lines.push(`VO   ${timecode(v.start)}  ${((v.end - v.start) / FPS).toFixed(2)}s  ${v.name}`));
      files.push({ path: "timeline.txt", content: `Timeline (30 fps, 1080x1920)\n\n${lines.join("\n")}\n` });
      notes.push(
        "CapCut can't import a project file, so the shots are already cut and numbered in timeline order: drop media/001, 002, ... onto the main track in order.",
        "Graphics are transparent clips: put each on an overlay track at the time in timeline.txt. Import captions.srt with Text > Import captions (or Auto captions > Import).",
        "Transitions, Ken Burns moves and clip volumes are listed in timeline.txt but not applied."
      );
      break;
    }
    case "concat":
      notes.push(
        "Open the project folder in Concat. If it asks for missing media, choose Relink and pick this folder: it finds every file by name.",
        "Or run make-paths-absolute (Mac/Linux: make-paths-absolute.sh, Windows: make-paths-absolute.ps1) once from this folder, then open the project."
      );
      break;
  }
  files.push({ path: "README.txt", content: readme(format, name, notes) });
  return { files, notes, capcutCuts };
}

function readme(format: ExportFormat, name: string, notes: string[]): string {
  return `${name}: exported from AutoCut for ${EXPORT_LABEL[format]}
Vertical 1080x1920, 30 fps. Unzip the whole folder somewhere, keep the files together, then:

${notes.map((n) => `- ${n}`).join("\n")}

Folder layout:
- media/: the scene clips, voiceover and rendered graphics, referenced by relative paths.
${format === "concat" ? "- project/: the Concat project (concat.json).\n" : ""}- captions.srt: the captions, when the ad has any.
`;
}

/** Scripts that rewrite a Concat project's relative media paths to absolute ones for wherever the bundle was unzipped. */
export const CONCAT_PATH_SCRIPTS: TextFile[] = [
  {
    path: "make-paths-absolute.sh",
    content: `#!/bin/sh
# Points project/concat.json at this folder's media, wherever it was unzipped.
cd "$(dirname "$0")" || exit 1
here=$(pwd)
sed -i.bak "s#\\"path\\": *\\"media/#\\"path\\":\\"$here/media/#g" project/concat.json && rm -f project/concat.json.bak
echo "Done. Open the project folder in Concat."
`,
  },
  {
    path: "make-paths-absolute.ps1",
    content: `# Points project\\concat.json at this folder's media, wherever it was unzipped.
$here = (Split-Path -Parent $MyInvocation.MyCommand.Path) -replace '\\\\', '/'
$file = Join-Path $PSScriptRoot 'project\\concat.json'
(Get-Content $file -Raw) -replace '"path":\\s*"media/', ('"path":"' + $here + '/media/') | Set-Content $file
Write-Output 'Done. Open the project folder in Concat.'
`,
  },
];
