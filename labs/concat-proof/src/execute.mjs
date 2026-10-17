// Turns an EditPlan into a Concat project through the JSON-RPC API only, and
// exports it. Track layout: T1 footage, T2 overlay graphics, T3 captions,
// T4 full-frame cards (drawn on top).
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Concat, findClip } from "./concat.mjs";
import { env } from "./env.mjs";
import { codeFor, renderGraphic } from "./graphics.mjs";

const INTER = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf";

/**
 * Builds the project and exports it.
 * @returns timings and the output path
 */
export async function executePlan({ plan, ad, adDir, workDir, name, output, width, height, crf, preset, log = () => {} }) {
  const timings = { graphics: [] };

  // Graphics first: they are independent of the timeline, and cached by hash.
  const graphicFiles = {};
  for (const g of plan.graphics) {
    const r = await renderGraphic(g, codeFor(g), workDir);
    graphicFiles[g.id] = r.file;
    timings.graphics.push({ id: g.id, layout: g.layout, seconds: g.duration, renderMs: r.ms, cached: r.cached });
    log(`graphic ${g.id}: ${r.cached ? "cached" : `${r.ms} ms`}`);
  }

  const t0 = performance.now();
  const location = join(workDir, "projects");
  const path = join(location, name);
  rmSync(path, { recursive: true, force: true });
  const cc = new Concat({ bin: env.concatBin, env: env.concatEnv, cwd: env.concatCwd });
  try {
    await cc.call("project.create", { location, name, video: { width: 1080, height: 1920, rateNum: 30, rateDen: 1 } });
    await cc.apply(path, { op: "addFont", family: "Inter", path: INTER }).catch((e) => log(`addFont: ${e.message}`));

    const media = {};
    for (const s of ad.scenes) media[s.index] = (await cc.call("media.import", { path, file: join(adDir, s.clip) })).createdId;

    // Footage, end to end on T1.
    let cursor = 0;
    for (const c of plan.clips) {
      const id = (await cc.apply(path, { op: "addClip", mediaId: media[c.scene], trackId: "T1", start: cursor })).createdId;
      if (c.sourceIn > 0) await cc.apply(path, { op: "trimClip", clipId: id, edge: "start", delta: c.sourceIn, ripple: true });
      const view = await cc.call("project.get", { path });
      const now = findClip(view, id).duration;
      const want = c.sourceOut - c.sourceIn;
      if (Math.abs(now - want) > 1e-3) await cc.apply(path, { op: "trimClip", clipId: id, edge: "end", delta: want - now });
      const patch = { volume: c.volume };
      if (c.transitionIn && c.transitionIn.type !== "cut") patch.transitionIn = { id: c.transitionIn.type, duration: c.transitionIn.duration };
      const cmds = [{ op: "updateClip", clipId: id, patch }];
      for (const k of c.motion?.keys ?? []) {
        for (const prop of ["scale", "offsetX", "offsetY"])
          cmds.push({ op: "setClipKey", clipId: id, property: prop, at: k.at, value: k[prop], ease: c.motion.ease });
      }
      await cc.apply(path, { op: "batch", commands: cmds });
      cursor += want;
    }

    // Captions as Concat titles on T3 (no render step, crisp at any size).
    for (const cap of plan.captions) {
      const st = plan.captionStyles.find((x) => x.name === cap.style);
      const id = (await cc.apply(path, { op: "addTextClip", trackId: "T3", start: cap.start, duration: cap.end - cap.start, offsetY: st.offsetY,
        style: { content: cap.text, fontFamily: "Inter", fontSize: st.fontSize, fontWeight: st.fontWeight, color: st.color, background: st.background,
          strokeWidth: st.strokeWidth, strokeColor: st.strokeColor, maxWidth: st.maxWidth, align: "center", shadow: !st.background } })).createdId;
      if (cap.popIn) {
        const at = Math.min(0.12 / (cap.end - cap.start), 0.5);
        await cc.apply(path, { op: "batch", commands: [
          { op: "setClipKey", clipId: id, property: "scale", at: 0, value: 0.85, ease: "out" },
          { op: "setClipKey", clipId: id, property: "scale", at, value: 1, ease: "out" },
        ] });
      }
    }

    // Graphics: overlays on T2 (ProRes 4444 alpha), full-frame cards on T4.
    for (const g of plan.graphics) {
      const m = (await cc.call("media.import", { path, file: graphicFiles[g.id] })).createdId;
      const id = (await cc.apply(path, { op: "addClip", mediaId: m, trackId: g.layout === "fullFrame" ? "T4" : "T2", start: g.start })).createdId;
      const view = await cc.call("project.get", { path });
      const now = findClip(view, id).duration;
      if (Math.abs(now - g.duration) > 1e-3) await cc.apply(path, { op: "trimClip", clipId: id, edge: "end", delta: g.duration - now });
    }

    await cc.call("project.save", { path });
    timings.buildMs = Math.round(performance.now() - t0);

    const t1 = performance.now();
    let lastPct = -10;
    const done = await cc.export({ path, output, codec: "h264", width, height, crf, preset }, (p) => {
      const pct = Math.floor((100 * p.frame) / Math.max(1, p.total));
      if (p.stage === "video" && pct >= lastPct + 25) { lastPct = pct; log(`export ${pct}%`); }
    });
    timings.exportMs = Math.round(performance.now() - t1);
    return { output: done.output, projectPath: path, timings };
  } finally {
    await cc.close();
  }
}
