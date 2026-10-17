import { Engine, type EngineRpc } from "./engine-client";
import { voiceoverStarts, type EditPlan } from "./plan-schema";

/**
 * Turns an EditPlan into a render-engine project through its API only.
 * Track layout: T1 footage, T2 overlay graphics, T3 captions, T4
 * full-frame cards (drawn on top), plus one added track for voiceover
 * audio when the ad has a separate voiceover.
 */

export type ExecuteInputs = {
  plan: EditPlan;
  /** Local file of each scene's clip, by scene index. */
  sceneFiles: Record<number, string>;
  /**
   * Separate voiceover audio by scene index, laid on its own track from
   * the start of that scene's first clip. Scenes whose clip already
   * carries the spoken line have none.
   */
  voiceoverFiles: Record<number, string>;
  /** Rendered graphic files by graphic id: ProRes 4444 .mov for overlays, MP4 for full-frame cards. */
  graphicFiles: Record<string, string>;
  /** A font file to register as Inter; empty to use the engine's own Inter (project exports). */
  fontPath: string;
  location: string;
  name: string;
  log?: (m: string) => void;
};

export async function buildProject(rpc: EngineRpc, inputs: ExecuteInputs): Promise<string> {
  const { plan, location, name, log = () => {} } = inputs;
  const engine = new Engine(rpc);
  const path = `${location}/${name}`;

  await rpc.call("project.create", { location, name, video: { width: 1080, height: 1920, rateNum: 30, rateDen: 1 } });
  if (inputs.fontPath) {
    await engine.apply(path, { op: "addFont", family: "Inter", path: inputs.fontPath }).catch((e: Error) => log(`addFont: ${e.message}`));
  }

  const media: Record<number, string> = {};
  for (const scene of new Set(plan.clips.map((c) => c.scene))) {
    const file = inputs.sceneFiles[scene];
    if (!file) throw new Error(`no footage for scene ${scene}`);
    media[scene] = (await rpc.call<{ createdId: string }>("media.import", { path, file })).createdId;
  }

  // Footage, end to end on T1. addClip takes the whole file; trim after.
  let cursor = 0;
  for (const c of plan.clips) {
    const id = (await engine.apply(path, { op: "addClip", mediaId: media[c.scene], trackId: "T1", start: cursor })).createdId!;
    if (c.sourceIn > 0) await engine.apply(path, { op: "trimClip", clipId: id, edge: "start", delta: c.sourceIn, ripple: true });
    const now = await engine.clipDuration(path, id);
    const want = c.sourceOut - c.sourceIn;
    if (Math.abs(now - want) > 1e-3) await engine.apply(path, { op: "trimClip", clipId: id, edge: "end", delta: want - now });
    const patch: Record<string, unknown> = { volume: c.volume };
    if (c.transitionIn && c.transitionIn.type !== "cut") patch.transitionIn = { id: c.transitionIn.type, duration: c.transitionIn.duration };
    const cmds: Record<string, unknown>[] = [{ op: "updateClip", clipId: id, patch }];
    for (const k of c.motion?.keys ?? []) {
      for (const prop of ["scale", "offsetX", "offsetY"] as const) {
        cmds.push({ op: "setClipKey", clipId: id, property: prop, at: k.at, value: k[prop], ease: c.motion!.ease });
      }
    }
    await engine.apply(path, { op: "batch", commands: cmds });
    cursor += want;
  }

  // Captions as engine titles on T3: no render step, crisp at any size.
  for (const cap of plan.captions) {
    const st = plan.captionStyles.find((x) => x.name === cap.style);
    if (!st) throw new Error(`caption style ${cap.style} missing`);
    const id = (await engine.apply(path, {
      op: "addTextClip", trackId: "T3", start: cap.start, duration: cap.end - cap.start, offsetY: st.offsetY,
      style: {
        content: cap.text, fontFamily: "Inter", fontSize: st.fontSize, fontWeight: st.fontWeight, color: st.color,
        background: st.background, strokeWidth: st.strokeWidth, strokeColor: st.strokeColor, maxWidth: st.maxWidth,
        align: "center", shadow: !st.background,
      },
    })).createdId!;
    if (cap.popIn) {
      const at = Math.min(0.12 / (cap.end - cap.start), 0.5);
      await engine.apply(path, { op: "batch", commands: [
        { op: "setClipKey", clipId: id, property: "scale", at: 0, value: 0.85, ease: "out" },
        { op: "setClipKey", clipId: id, property: "scale", at, value: 1, ease: "out" },
      ] });
    }
  }

  // Graphics: overlays on T2 (ProRes 4444 keeps alpha), full-frame cards on T4.
  for (const g of plan.graphics) {
    const file = inputs.graphicFiles[g.id];
    if (!file) throw new Error(`graphic ${g.id} was not rendered`);
    const m = (await rpc.call<{ createdId: string }>("media.import", { path, file })).createdId;
    const id = (await engine.apply(path, { op: "addClip", mediaId: m, trackId: g.layout === "fullFrame" ? "T4" : "T2", start: g.start })).createdId!;
    const now = await engine.clipDuration(path, id);
    if (Math.abs(now - g.duration) > 1e-3) await engine.apply(path, { op: "trimClip", clipId: id, edge: "end", delta: g.duration - now });
  }

  // Separate voiceover on its own track.
  const voStarts = voiceoverStarts(plan);
  const voScenes = Object.keys(inputs.voiceoverFiles).map(Number).filter((s) => voStarts[s] !== undefined);
  if (voScenes.length) {
    const track = (await engine.apply(path, { op: "addTrack", bottom: false })).createdId;
    if (!track) throw new Error("could not add a voiceover track");
    for (const s of voScenes) {
      const m = (await rpc.call<{ createdId: string }>("media.import", { path, file: inputs.voiceoverFiles[s] })).createdId;
      await engine.apply(path, { op: "addClip", mediaId: m, trackId: track, start: voStarts[s] });
    }
  }

  await rpc.call("project.save", { path });
  return path;
}

export type ExportSettings = { width: number; height: number; crf: number; preset: string };
export const PREVIEW_EXPORT: ExportSettings = { width: 540, height: 960, crf: 30, preset: "veryfast" };
export const FINAL_EXPORT: ExportSettings = { width: 1080, height: 1920, crf: 20, preset: "medium" };

export async function exportProject(
  rpc: EngineRpc,
  path: string,
  output: string,
  settings: ExportSettings,
  { timeoutMs, onProgress }: { timeoutMs: number; onProgress?: (pct: number) => void }
): Promise<string> {
  const engine = new Engine(rpc);
  let lastPct = -10;
  const done = await engine.export(
    { path, output, codec: "h264", ...settings },
    {
      timeoutMs,
      onProgress: (frame, total) => {
        const pct = Math.floor((100 * frame) / Math.max(1, total));
        if (pct >= lastPct + 10) {
          lastPct = pct;
          onProgress?.(pct);
        }
      },
    }
  );
  return done.output;
}
