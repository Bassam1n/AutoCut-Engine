import { describe, expect, it } from "vitest";
import cleanFixture from "./__fixtures__/clean-plan.json";
import type { EngineRpc } from "./engine-client";
import { buildProject, fillFactor, exportProject, PREVIEW_EXPORT } from "./executor";
import { EditPlan } from "./plan-schema";

/**
 * A fake render engine: records every call, mints ids, and keeps clip
 * durations the way the real one does (addClip takes the whole file,
 * trims change it), so the executor's trim arithmetic is exercised.
 */
class FakeEngine implements EngineRpc {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  private n = 0;
  private clips = new Map<string, number>();
  private mediaLength = new Map<string, number>();
  private listeners = new Set<(m: string, p: Record<string, unknown>) => void>();
  constructor(private fileLength: (file: string) => number) {}

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    const id = (p: string) => `${p}${++this.n}`;
    if (method === "media.import") {
      const m = id("m");
      this.mediaLength.set(m, this.fileLength(String(params.file)));
      return { createdId: m } as T;
    }
    if (method === "project.get") {
      return { project: { activeTimelineId: "tl", timelines: [{ id: "tl", clips: [...this.clips].map(([cid, duration]) => ({ id: cid, duration })) }] } } as T;
    }
    if (method === "export.run") {
      setTimeout(() => {
        for (const l of this.listeners) l("export.progress", { job: "j1", frame: 450, total: 900 });
        for (const l of this.listeners) l("export.done", { job: "j1", output: params.output });
      }, 0);
      return { job: "j1" } as T;
    }
    if (method === "edit.apply") {
      const c = params.command as Record<string, unknown>;
      if (c.op === "addClip") {
        const cid = id("c");
        this.clips.set(cid, this.mediaLength.get(String(c.mediaId)) ?? 5);
        return { createdId: cid } as T;
      }
      if (c.op === "trimClip") {
        const cur = this.clips.get(String(c.clipId))!;
        this.clips.set(String(c.clipId), c.edge === "start" ? cur - Number(c.delta) : cur + Number(c.delta));
        return {} as T;
      }
      if (c.op === "addTextClip") return { createdId: id("c") } as T;
      if (c.op === "addTrack") return { createdId: "t4" } as T;
      return {} as T;
    }
    return {} as T;
  }
  onEvent(l: (m: string, p: Record<string, unknown>) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  async close() {}
  commands(op: string) {
    return this.calls.filter((c) => c.method === "edit.apply").map((c) => c.params.command as Record<string, unknown>).filter((c) => c.op === op);
  }
}

const plan = () => EditPlan.parse(structuredClone(cleanFixture));
const inputs = (p: EditPlan, voiceoverFiles: Record<number, string> = {}) => ({
  plan: p,
  sceneFiles: Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, `/media/scene-${i}.mp4`])),
  voiceoverFiles,
  graphicFiles: Object.fromEntries(p.graphics.map((g) => [g.id, `/g/${g.id}.${g.layout === "fullFrame" ? "mp4" : "mov"}`])),
  fontPath: "/fonts/Inter.otf",
  location: "/work/projects",
  name: "final",
});
const lengthOf = (file: string) => (file.includes("vo-") ? 3.2 : file.startsWith("/g/") ? 10 : 6.04);

describe("buildProject", () => {
  it("lays the plan out on the engine's tracks", async () => {
    const engine = new FakeEngine(lengthOf);
    const p = plan();
    const path = await buildProject(engine, inputs(p));
    expect(path).toBe("/work/projects/final");
    expect(engine.calls[0]).toEqual({ method: "project.create", params: { location: "/work/projects", name: "final", video: { width: 1080, height: 1920, rateNum: 30, rateDen: 1 } } });

    const adds = engine.commands("addClip");
    const footage = adds.filter((c) => c.trackId === "T1");
    expect(footage.map((c) => c.start)).toEqual([0, 5.5, 9.5, 15.5, 21.516].map((n) => expect.closeTo(n, 3)));
    // Overlays on T2, the full-frame end card on T4.
    expect(adds.filter((c) => c.trackId === "T2")).toHaveLength(p.graphics.filter((g) => g.layout === "overlay").length);
    expect(adds.filter((c) => c.trackId === "T4")).toHaveLength(1);
    // Every caption is a title on T3 with its style.
    const titles = engine.commands("addTextClip");
    expect(titles).toHaveLength(p.captions.length);
    expect(titles[0]).toMatchObject({ trackId: "T3", start: p.captions[0].start, style: { content: p.captions[0].text, fontFamily: "Inter" } });
    // No voiceover, no extra track.
    expect(engine.commands("addTrack")).toHaveLength(0);
    expect(engine.calls.at(-1)?.method).toBe("project.save");
  });

  it("trims each shot to its source range", async () => {
    const engine = new FakeEngine(lengthOf);
    const p = plan();
    await buildProject(engine, inputs(p));
    const trims = engine.commands("trimClip");
    // First clip: 0.3 off the head (rippled), then the tail to 5.5 s.
    expect(trims[0]).toMatchObject({ edge: "start", delta: 0.3, ripple: true });
    expect(trims[1]).toMatchObject({ edge: "end" });
    expect(Number(trims[1].delta)).toBeCloseTo(5.5 - (6.04 - 0.3), 6);
  });

  it("keys Ken Burns moves and transitions in one batch per clip", async () => {
    const engine = new FakeEngine(lengthOf);
    const p = plan();
    p.clips[1].transitionIn = { type: "cross-fade", duration: 0.4 };
    p.clips[1].motion = { ease: "out", keys: [{ at: 0, scale: 1, offsetX: 0, offsetY: 0 }, { at: 1, scale: 1.1, offsetX: 0.02, offsetY: 0 }] };
    await buildProject(engine, inputs(p));
    const batch = engine.commands("batch")[1].commands as Record<string, unknown>[];
    expect(batch[0]).toMatchObject({ op: "updateClip", patch: { volume: p.clips[1].volume, transitionIn: { id: "cross-fade", duration: 0.4 } } });
    expect(batch.filter((c) => c.op === "setClipKey")).toHaveLength(6);
  });

  it("scales footage that isn't 9:16 up to fill the frame, Ken Burns included", async () => {
    expect(fillFactor({ width: 720, height: 1280 })).toBeCloseTo(1, 9);
    expect(fillFactor({ width: 1280, height: 720 })).toBeCloseTo((1920 / 720) / (1080 / 1280), 9);
    expect(fillFactor(undefined)).toBe(1);
    const engine = new FakeEngine(lengthOf);
    const p = plan();
    p.clips[1].scene = 1000;
    p.clips[2].scene = 1000;
    p.clips[2].motion = { ease: "linear", keys: [{ at: 0, scale: 1, offsetX: 0, offsetY: 0 }, { at: 1, scale: 1.1, offsetX: 0, offsetY: 0 }] };
    await buildProject(engine, { ...inputs(p), sceneFiles: { ...inputs(p).sceneFiles, 1000: "/media/upload.mov" }, footageSize: { 1000: { width: 1920, height: 1080 } } });
    const keys = (n: number) => (engine.commands("batch")[n].commands as Record<string, unknown>[]).filter((c) => c.op === "setClipKey" && c.property === "scale").map((c) => c.value);
    const f = fillFactor({ width: 1920, height: 1080 });
    expect(keys(0)).toEqual((p.clips[0].motion?.keys ?? []).map((k) => k.scale));
    expect(keys(1)).toEqual([expect.closeTo(f, 9)]);
    expect(keys(2)).toEqual([expect.closeTo(f, 9), expect.closeTo(1.1 * f, 9)]);
  });

  it("puts a separate voiceover on its own track from its scene's first clip", async () => {
    const engine = new FakeEngine(lengthOf);
    const p = plan();
    await buildProject(engine, inputs(p, { 1: "/media/vo-1.mp3", 3: "/media/vo-3.mp3" }));
    expect(engine.commands("addTrack")).toEqual([{ op: "addTrack", bottom: false }]);
    const vo = engine.commands("addClip").filter((c) => c.trackId === "t4");
    // Scene 3 isn't in this cut, so its line is dropped with it.
    expect(vo).toHaveLength(1);
    expect(vo[0].start).toBeCloseTo(5.5, 6);
  });

  it("refuses a plan whose footage or graphics are missing", async () => {
    const p = plan();
    await expect(buildProject(new FakeEngine(lengthOf), { ...inputs(p), sceneFiles: {} })).rejects.toThrow("no footage for scene 0");
    await expect(buildProject(new FakeEngine(lengthOf), { ...inputs(p), graphicFiles: {} })).rejects.toThrow(/was not rendered/);
  });
});

describe("exportProject", () => {
  it("resolves with the output when the engine reports done", async () => {
    const engine = new FakeEngine(lengthOf);
    const pct: number[] = [];
    const out = await exportProject(engine, "/work/projects/final", "/work/final.mp4", PREVIEW_EXPORT, { timeoutMs: 5_000, onProgress: (p) => pct.push(p) });
    expect(out).toBe("/work/final.mp4");
    expect(pct).toEqual([50]);
    expect(engine.calls.find((c) => c.method === "export.run")?.params).toMatchObject({ codec: "h264", width: 540, height: 960 });
  });
});

describe("toolchainPaths", () => {
  it("gives the render tools a HOME and no secrets", async () => {
    const { toolchainPaths } = await import("./toolchain");
    const p = toolchainPaths({ PATH: "/usr/bin", SUPABASE_SERVICE_ROLE_KEY: "s", TRIGGER_SECRET_KEY: "t", NODE_ENV: "test" });
    expect(p.concatEnv.HOME).toBe("/tmp");
    expect(p.hyperframesEnv.HOME).toBe("/tmp");
    expect(p.concatEnv.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(p.hyperframesEnv.TRIGGER_SECRET_KEY).toBeUndefined();
  });
});
