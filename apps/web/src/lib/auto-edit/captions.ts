import type { PlanCaption } from "./plan-schema";

/**
 * Caption rule: never split a sentence across captions unless it can't
 * fit in one. The labs proof's designed run split "You think black
 * coffee tastes / like burnt toast. Fair." across two captions, which
 * reads badly; the plan lint now refuses that and sends it back to
 * Claude.
 *
 * "Fits" means at most CAPTION_MAX_WORDS words and CAPTION_MAX_CHARS
 * characters, the same limits every single caption is held to, so a
 * sentence that fits must be one caption and one that doesn't must be
 * split.
 */
export const CAPTION_MAX_WORDS = 8;
export const CAPTION_MAX_CHARS = 48;

// A colon or semicolon also ends a "sentence" for captions: what
// follows it reads as its own line ("Okay, confession:" / "...").
const SENTENCE_END = /[.!?…:;]["'”’)\]]*$/;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function fitsOneCaption(text: string): boolean {
  const t = text.trim();
  return wordCount(t) <= CAPTION_MAX_WORDS && t.length <= CAPTION_MAX_CHARS;
}

/** Splits text into sentences at the whitespace after closing punctuation, so "5.5%" or "18:00" stay whole. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…:;]["'”’)\]]*)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type CaptionSplit = {
  /** Index of the caption the sentence starts in. */
  from: number;
  /** Index of the caption it ends in. */
  to: number;
  sentence: string;
};

/**
 * Every sentence that runs across more than one caption, with whether it
 * would have fit in one. Captions are read in order as one stream of
 * text; a caption boundary that isn't at a sentence end splits the
 * sentence that contains it.
 */
export function findSplitSentences(captions: Pick<PlanCaption, "text">[]): (CaptionSplit & { fits: boolean })[] {
  const splits: (CaptionSplit & { fits: boolean })[] = [];
  let open: { from: number; parts: string[] } | null = null;
  captions.forEach((c, i) => {
    const text = c.text.trim();
    if (!text) return;
    const parts = sentences(text);
    const endsSentence = SENTENCE_END.test(text);
    if (open) {
      // The first sentence of this caption finishes the open one.
      open.parts.push(parts[0] ?? text);
      const finished = parts.length > 1 || endsSentence;
      if (finished) {
        const sentence = open.parts.join(" ");
        splits.push({ from: open.from, to: i, sentence, fits: fitsOneCaption(sentence) });
        open = null;
        if (parts.length > 1 && !endsSentence) open = { from: i, parts: [parts[parts.length - 1]] };
      }
      return;
    }
    if (!endsSentence) open = { from: i, parts: [parts[parts.length - 1] ?? text] };
  });
  if (open) {
    const o = open as { from: number; parts: string[] };
    if (o.parts.length > 1) {
      const sentence = o.parts.join(" ");
      splits.push({ from: o.from, to: captions.length - 1, sentence, fits: fitsOneCaption(sentence) });
    }
  }
  return splits;
}

/** Lint problems for the caption rule, worded for Claude. */
export function captionRuleProblems(captions: Pick<PlanCaption, "text">[]): string[] {
  const p: string[] = [];
  captions.forEach((c, i) => {
    if (!fitsOneCaption(c.text)) {
      p.push(`captions[${i}]: "${c.text}" is longer than ${CAPTION_MAX_WORDS} words or ${CAPTION_MAX_CHARS} characters; split it at a natural break`);
    }
  });
  for (const s of findSplitSentences(captions)) {
    if (s.fits) {
      p.push(`captions[${s.from}..${s.to}]: the sentence "${s.sentence}" is split across captions but fits in one; show it as one caption`);
    }
  }
  return p;
}
