import { describe, expect, it } from "vitest";
import cleanFixture from "./__fixtures__/clean-plan.json";
import designedFixture from "./__fixtures__/designed-plan.json";
import { lintPlan, previewSampleTimes, problemForEditors, unsafeGraphics, type LintContext } from "./lint";
import { EditPlan, planLength, voiceoverStarts } from "./plan-schema";

// The two plans Claude wrote in the labs proof (clean = its template
// run after review, designed = its direct run before review), on the
// proof's six 6.04 s clips.
const ctx: LintContext = { targetLengthSeconds: 30, clipDurations: { 0: 6.04, 1: 6.04, 2: 6.04, 3: 6.04, 4: 6.04, 5: 6.04 } };
const clean = () => EditPlan.parse(structuredClone(cleanFixture));
const designed = () => EditPlan.parse(structuredClone(designedFixture));

describe("EditPlan schema", () => {
  it("parses both proof plans", () => {
    expect(clean().clips).toHaveLength(5);
    expect(designed().graphics.every((g) => g.code && g.template)).toBe(true);
  });

  it("requires a template on every graphic (designed mode's fallback)", () => {
    const raw = structuredClone(designedFixture) as { graphics: { template: unknown }[] };
    raw.graphics[0].template = null;
    expect(EditPlan.safeParse(raw).success).toBe(false);
  });

  it("measures length as clips plus the end card hold", () => {
    expect(planLength(clean())).toBeCloseTo(30, 1);
  });
});

describe("lintPlan", () => {
  it("passes the proof's reviewed clean plan", () => {
    expect(lintPlan(clean(), ctx, "clean")).toEqual([]);
  });

  it("refuses code in clean mode and missing code in designed mode", () => {
    const d = designed();
    expect(lintPlan(d, ctx, "clean").some((p) => p.includes("clean mode uses templates only"))).toBe(true);
    const c = clean();
    expect(lintPlan(c, ctx, "designed").filter((p) => p.includes("designed mode needs code"))).toHaveLength(c.graphics.length);
  });

  it("catches the proof's split sentence in the designed plan", () => {
    const problems = lintPlan(designed(), ctx, "designed");
    expect(problems).toContainEqual(expect.stringContaining('"You think black coffee tastes like burnt toast."'));
  });

  it("checks footage bounds, transitions handles and Ken Burns edges", () => {
    const p = clean();
    p.clips[1].sourceOut = 9;
    p.clips[2].transitionIn = { type: "cross-fade", duration: 1 };
    p.clips[3].motion = { ease: "linear", keys: [{ at: 0, scale: 1.05, offsetX: 0.1, offsetY: 0 }, { at: 1, scale: 0.9, offsetX: 0, offsetY: 0 }] };
    const problems = lintPlan(p, ctx, "clean");
    expect(problems).toContainEqual(expect.stringMatching(/^clips\[1\]: source 0-9/));
    expect(problems).toContainEqual(expect.stringMatching(/^clips\[2\]: cross-fade of 1s needs 0.5s/));
    expect(problems).toContainEqual(expect.stringMatching(/^clips\[3\]: offset larger/));
    expect(problems).toContainEqual(expect.stringMatching(/^clips\[3\]: scale 0.9 below 1/));
  });

  it("checks the target length, unknown scenes and missing template text", () => {
    const p = clean();
    p.clips.push({ ...p.clips[0], scene: 9 });
    p.endCardHold = 12;
    p.graphics[0].template.props.headline = "";
    const problems = lintPlan(p, ctx, "clean");
    expect(problems).toContainEqual(expect.stringMatching(/^clips\[5\]: there is no scene 9/));
    expect(problems).toContainEqual(expect.stringMatching(/^total length .* from the 30s target/));
    expect(problems).toContainEqual(expect.stringMatching(/hookPill needs props.headline/));
  });

  it("refuses overlapping captions and unknown styles", () => {
    const p = clean();
    p.captions[1].start = p.captions[0].start;
    p.captions[2].style = "nope";
    const problems = lintPlan(p, ctx, "clean");
    expect(problems).toContainEqual("captions[1]: overlaps the previous caption");
    expect(problems).toContainEqual("captions[2]: unknown style nope");
  });

  it("refuses a separate voiceover that runs into the next scene's", () => {
    const p = clean();
    const starts = voiceoverStarts(p);
    const problems = lintPlan(p, { ...ctx, voiceoverDurations: { 0: 7, 1: 2 } }, "clean");
    expect(starts[0]).toBe(0);
    expect(problems).toContainEqual(expect.stringMatching(/^scene 0's voiceover \(7.00s from 0.00s\) runs into scene 1's/));
  });
});

describe("unsafeGraphics", () => {
  it("passes every graphic Claude wrote in the proof", () => {
    expect(unsafeGraphics(designed())).toEqual({});
  });
});

describe("previewSampleTimes", () => {
  it("caps the frames sent for review", () => {
    const ts = previewSampleTimes(designed(), 16);
    expect(ts.length).toBeLessThanOrEqual(16);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

describe("problemForEditors", () => {
  it("names clips, captions and transitions the way the editor shows them", () => {
    expect(problemForEditors("clips[2]: concat.whip-pan of 0.6s needs 0.3s of unused footage before sourceIn and after the previous clip's sourceOut"))
      .toBe("Clip 3: the Whip pan (0.6 s) needs 0.3s of unused footage before this clip's start and after the previous clip's end; trim them in a little or shorten the transition");
    expect(problemForEditors("captions[0]: overlaps the previous caption")).toBe("Caption 1: overlaps the previous caption");
    expect(problemForEditors("clips[0]: source 0-9 is outside 0-6.04 or under 0.5 s")).toBe("Clip 1: the part used (0-9 s) is outside 0-6.04 or under 0.5 s");
  });
});
