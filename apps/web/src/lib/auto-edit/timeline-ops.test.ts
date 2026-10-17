import { describe, expect, it } from "vitest";
import cleanFixture from "./__fixtures__/clean-plan.json";
import designedFixture from "./__fixtures__/designed-plan.json";
import { renderProblems } from "./lint";
import { EditPlan, clipStarts, planLength } from "./plan-schema";
import { previewAt } from "./preview-model";
import { TRANSITION_CATALOGUE } from "./transitions";
import {
  addCaption, deleteClip, insertClip, deleteGraphic, kenBurnsOf, moveCaption, moveClip, planFromScenes, retimeGraphic,
  setKenBurns, setTransition, splitClip, trimClip, updateCaption,
} from "./timeline-ops";

const durations = { 0: 6.04, 1: 6.04, 2: 6.04, 3: 6.04, 4: 6.04, 5: 6.04 };
const plan = () => EditPlan.parse(structuredClone(cleanFixture));

describe("clip edits", () => {
  it("moves a clip and the captions over it", () => {
    const p = plan();
    // Clip 1 (scene 1) runs 5.5-9.5 s; its captions start inside it.
    const onClip1 = p.captions.filter((c) => c.start >= 5.5 && c.start < 9.5).map((c) => c.text);
    const q = moveClip(p, 1, 0);
    expect(q.clips.map((c) => c.scene)).toEqual([1, 0, 2, 4, 5]);
    expect(q.captions.filter((c) => c.start < 4).map((c) => c.text)).toEqual(onClip1);
    expect(planLength(q)).toBeCloseTo(planLength(p), 6);
    expect(renderProblems(q, { clipDurations: durations })).toEqual([]);
  });

  it("trims within the footage and keeps the end card at the end", () => {
    const p = plan();
    const endcard = p.graphics.find((g) => g.layout === "fullFrame")!;
    const q = trimClip(p, 0, "out", 4.3, 6.04);
    expect(q.clips[0].sourceOut).toBe(4.3);
    expect(q.graphics.find((g) => g.id === endcard.id)!.start).toBeCloseTo(endcard.start - 1.5, 6);
    expect(trimClip(p, 0, "out", 99, 6.04).clips[0].sourceOut).toBe(6.04);
    expect(trimClip(p, 0, "in", 5.5, 6.04).clips[0].sourceIn).toBe(5.3);
  });

  it("never leaves captions overlapping after a clip gets shorter", () => {
    for (const fixture of [cleanFixture, designedFixture]) {
      const p = EditPlan.parse(structuredClone(fixture));
      for (let i = 0; i < p.clips.length; i++) {
        const c = p.clips[i];
        const q = trimClip(p, i, "out", c.sourceIn + 0.6, 6.04);
        expect(renderProblems(q, { clipDurations: durations }).filter((m) => m.includes("overlaps"))).toEqual([]);
      }
    }
  });

  it("inserts footage after the clip under the playhead and moves what follows", () => {
    const p = plan();
    const starts = clipStarts(p);
    const later = p.captions.filter((c) => c.start >= starts[2]).map((c) => c.start);
    const q = insertClip(p, starts[1] + 0.5, 1000, 4);
    expect(q.clips.map((c) => c.scene)).toEqual([0, 1, 1000, 2, 4, 5]);
    expect(q.clips[2]).toMatchObject({ sourceIn: 0, sourceOut: 4, transitionIn: null, volume: 1 });
    expect(planLength(q)).toBeCloseTo(planLength(p) + 4, 6);
    expect(q.captions.filter((c) => c.start >= starts[2] + 4).map((c) => c.start)).toEqual(later.map((s) => s + 4));
    expect(renderProblems(q, { clipDurations: { ...durations, 1000: 4 } })).toEqual([]);
    // Past the footage (on the end card): appended.
    expect(insertClip(p, planLength(p) - 0.1, 1001, 3).clips.at(-1)!.scene).toBe(1001);
  });

  it("splits a clip at the playhead without changing the cut", () => {
    const p = plan();
    const q = splitClip(p, 2);
    expect(q.clips).toHaveLength(p.clips.length + 1);
    expect(q.clips[0].sourceOut).toBeCloseTo(p.clips[0].sourceIn + 2, 6);
    expect(q.clips[1].sourceIn).toBeCloseTo(q.clips[0].sourceOut, 6);
    expect(planLength(q)).toBeCloseTo(planLength(p), 6);
    // Too close to a cut: nothing happens.
    expect(splitClip(p, 0.1)).toBe(p);
  });

  it("deletes a clip, never the last one, and never leaves a transition on the first", () => {
    let p = plan();
    p = setTransition(p, 1, "cross-fade", 0.5);
    const q = deleteClip(p, 0);
    expect(q.clips[0].transitionIn).toBeNull();
    let one = plan();
    while (one.clips.length > 1) one = deleteClip(one, 0);
    expect(deleteClip(one, 0)).toBe(one);
  });

  it("applies Ken Burns presets inside the edge rule", () => {
    for (const preset of ["zoomIn", "zoomOut", "panLeft", "panRight"] as const) {
      const q = setKenBurns(plan(), 2, preset);
      expect(kenBurnsOf(q.clips[2])).toBe(preset);
      expect(renderProblems(q, { clipDurations: durations })).toEqual([]);
    }
    expect(setKenBurns(plan(), 2, "none").clips[2].motion).toBeNull();
  });
});

describe("caption and graphic edits", () => {
  it("edits, moves and adds captions, keeping them in order", () => {
    const p = plan();
    const q = updateCaption(p, 0, { text: "Hello" });
    expect(q.captions[0].text).toBe("Hello");
    const len = p.captions[2].end - p.captions[2].start;
    const moved = moveCaption(p, 2, 0.1);
    expect(moved.captions[0].start).toBe(0.1);
    expect(moved.captions[0].end - moved.captions[0].start).toBeCloseTo(len, 6);
    const added = addCaption(p, 29);
    expect(added.captions).toHaveLength(p.captions.length + 1);
    expect(added.captions.at(-1)!.text).toBe("New caption");
  });

  it("retimes and deletes graphics", () => {
    const p = plan();
    const q = retimeGraphic(p, "hook", 1, 2);
    expect(q.graphics.find((g) => g.id === "hook")).toMatchObject({ start: 1, duration: 2 });
    const noEnd = deleteGraphic(p, p.graphics.find((g) => g.layout === "fullFrame")!.id);
    expect(noEnd.endCardHold).toBe(0);
  });
});

describe("planFromScenes", () => {
  it("lays every scene end to end with its script as captions", () => {
    const p = planFromScenes(
      [{ index: 0, copy: "Hello there. Welcome." }, { index: 1, copy: "Buy now!" }],
      { 0: 4, 1: 3 }
    );
    expect(EditPlan.parse(p).clips.map((c) => [c.scene, c.sourceOut])).toEqual([[0, 4], [1, 3]]);
    expect(p.captions.map((c) => c.text)).toEqual(["Hello there.", "Welcome.", "Buy now!"]);
    expect(p.captions.at(-1)!.end).toBeCloseTo(7, 6);
    expect(renderProblems(p, { clipDurations: { 0: 4, 1: 3 } })).toEqual([]);
  });
});

describe("previewAt", () => {
  it("shows the clip under the playhead at its source time", () => {
    const p = plan();
    const s = previewAt(p, 6);
    expect(s.clips).toHaveLength(1);
    expect(s.clips[0]).toMatchObject({ index: 1, scene: 1, opacity: 1 });
    expect(s.clips[0].sourceTime).toBeCloseTo(p.clips[1].sourceIn + (6 - clipStarts(p)[1]), 6);
  });

  it("cross-fades across a cut using footage past both sides", () => {
    const p = setTransition(plan(), 1, "cross-fade", 0.4);
    const cut = clipStarts(p)[1];
    const s = previewAt(p, cut - 0.1);
    expect(s.clips.map((c) => c.index)).toEqual([0, 1]);
    expect(s.clips[1].opacity).toBeCloseTo(0.25, 6);
    expect(s.clips[0].sourceTime).toBeCloseTo(p.clips[0].sourceOut - 0.1, 6);
    expect(s.clips[1].sourceTime).toBeCloseTo(p.clips[1].sourceIn - 0.1, 6);
  });

  it("draws every engine transition on both clips, inside the frame", () => {
    for (const t of TRANSITION_CATALOGUE) {
      const p = setTransition(plan(), 1, t.id, 0.6);
      expect(EditPlan.parse(p).clips[1].transitionIn).toEqual({ type: t.id, duration: 0.6 });
      const cut = clipStarts(p)[1];
      for (const dt of [-0.29, -0.1, 0, 0.1, 0.29]) {
        const s = previewAt(p, cut + dt);
        expect(s.clips.map((c) => c.index)).toEqual([0, 1]);
        for (const c of s.clips) expect(c.opacity >= 0 && c.opacity <= 1).toBe(true);
        if (s.wash) expect(s.wash.opacity).toBeLessThanOrEqual(1);
      }
      // Fully the incoming clip once the transition is over.
      expect(previewAt(p, cut + 0.31).clips.map((c) => [c.index, c.look])).toEqual([[1, undefined]]);
    }
  });

  it("dips through the colour mid-way", () => {
    const p = setTransition(plan(), 1, "fade-black", 0.6);
    const s = previewAt(p, clipStarts(p)[1]);
    expect(s.wash).toEqual({ color: "#000", opacity: expect.closeTo(1, 6) });
  });

  it("interpolates Ken Burns keys", () => {
    const p = setKenBurns(plan(), 0, "zoomIn");
    const mid = clipStarts(p)[0] + (p.clips[0].sourceOut - p.clips[0].sourceIn) / 2;
    expect(previewAt(p, mid).clips[0].scale).toBeCloseTo(1.06, 6);
  });

  it("lists captions, graphics and voiceover on screen", () => {
    const p = plan();
    const s = previewAt(p, 1, { 1: 2 });
    expect(s.graphics.map((g) => g.id)).toContain("hook");
    expect(previewAt(p, p.captions[0].start + 0.1).captions).toEqual([0]);
    expect(s.voiceovers).toEqual([]);
    expect(previewAt(p, clipStarts(p)[1] + 0.5, { 1: 2 }).voiceovers).toEqual([{ scene: 1, local: expect.closeTo(0.5, 6) }]);
  });
});
