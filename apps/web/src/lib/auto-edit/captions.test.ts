import { describe, expect, it } from "vitest";
import { captionRuleProblems, findSplitSentences, fitsOneCaption, sentences } from "./captions";

const caps = (...texts: string[]) => texts.map((text) => ({ text }));

describe("caption rule: never split a sentence that fits in one caption", () => {
  it("flags the proof's split", () => {
    const splits = findSplitSentences(caps("Okay, confession:", "You think black coffee tastes", "like burnt toast. Fair.", "Most of it kinda does."));
    expect(splits).toEqual([{ from: 1, to: 2, sentence: "You think black coffee tastes like burnt toast.", fits: true }]);
    expect(captionRuleProblems(caps("You think black coffee tastes", "like burnt toast. Fair."))).toHaveLength(1);
  });

  it("allows splitting a sentence that can't fit in one caption", () => {
    const c = caps("Slow-steeped for 18 whole hours", "in small batches,", "deep, mellow, genuinely smooth.");
    expect(findSplitSentences(c)).toEqual([expect.objectContaining({ from: 0, to: 2, fits: false })]);
    expect(captionRuleProblems(c)).toEqual([]);
  });

  it("accepts one sentence per caption and several short sentences in one", () => {
    expect(captionRuleProblems(caps("We don't rush.", "Never bitter.", "One sip. Taste the difference."))).toEqual([]);
  });

  it("treats an unfinished last caption as a sentence of its own", () => {
    expect(findSplitSentences(caps("Find it at your store today"))).toEqual([]);
  });

  it("flags a sentence carried on after another one ends mid-caption", () => {
    const splits = findSplitSentences(caps("Never bitter. No added", "sugar either."));
    expect(splits).toEqual([{ from: 0, to: 1, sentence: "No added sugar either.", fits: true }]);
  });

  it("holds every caption to the size limit", () => {
    expect(fitsOneCaption("one two three four five six seven eight")).toBe(true);
    expect(fitsOneCaption("one two three four five six seven eight nine")).toBe(false);
    expect(captionRuleProblems(caps("one two three four five six seven eight nine."))).toEqual([
      expect.stringContaining("is longer than 8 words"),
    ]);
  });

  it("doesn't break sentences at decimals or clock times", () => {
    expect(sentences("Only 5.5g of sugar. Open 18:00 daily!")).toEqual(["Only 5.5g of sugar.", "Open 18:00 daily!"]);
  });
});
