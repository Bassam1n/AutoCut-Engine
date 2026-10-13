import { describe, it, expect } from "vitest";
import { groupWordsIntoCues, cuesToSrt, type TimestampedWord } from "./srt";

describe("groupWordsIntoCues", () => {
  it("groups consecutive words with small gaps into one cue", () => {
    const words: TimestampedWord[] = [
      { text: "hello", start: 0, end: 0.3 },
      { text: "there", start: 0.35, end: 0.6 },
      { text: "friend", start: 0.65, end: 1.0 },
    ];
    const cues = groupWordsIntoCues(words);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ index: 1, startS: 0, endS: 1.0, text: "hello there friend" });
  });

  it("breaks a cue on a pause >= maxPauseS", () => {
    const words: TimestampedWord[] = [
      { text: "hello", start: 0, end: 0.3 },
      { text: "there", start: 0.35, end: 0.6 },
      // 1.0s gap, over the default 0.6s threshold.
      { text: "friend", start: 1.6, end: 2.0 },
    ];
    const cues = groupWordsIntoCues(words);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("hello there");
    expect(cues[1].text).toBe("friend");
    expect(cues[1].index).toBe(2);
  });

  it("does not break on a pause right under the threshold", () => {
    const words: TimestampedWord[] = [
      { text: "hello", start: 0, end: 0.3 },
      { text: "there", start: 0.89, end: 1.1 }, // 0.59s gap, under default 0.6s
    ];
    const cues = groupWordsIntoCues(words, { maxPauseS: 0.6 });
    expect(cues).toHaveLength(1);
  });

  it("breaks a cue once it reaches maxWordsPerCue, even with no pause", () => {
    const words: TimestampedWord[] = Array.from({ length: 10 }, (_, i) => ({
      text: `w${i}`,
      start: i * 0.2,
      end: i * 0.2 + 0.15,
    }));
    const cues = groupWordsIntoCues(words, { maxWordsPerCue: 4, maxPauseS: 999, maxDurationS: 999 });
    expect(cues).toHaveLength(3);
    expect(cues[0].text).toBe("w0 w1 w2 w3");
    expect(cues[1].text).toBe("w4 w5 w6 w7");
    expect(cues[2].text).toBe("w8 w9");
  });

  it("breaks a cue once adding the next word would exceed maxDurationS, even under the word cap", () => {
    const words: TimestampedWord[] = [
      { text: "sloooow", start: 0, end: 3 },
      { text: "words", start: 3.1, end: 6 },
      // Cumulative span so far: 0 -> 6 = 6s. Adding this word makes it 0 -> 9, over a 7s cap.
      { text: "here", start: 6.1, end: 9 },
    ];
    const cues = groupWordsIntoCues(words, { maxDurationS: 7, maxWordsPerCue: 999, maxPauseS: 999 });
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("sloooow words");
    expect(cues[1].text).toBe("here");
  });

  it("returns an empty array for no words", () => {
    expect(groupWordsIntoCues([])).toEqual([]);
  });

  it("produces 1-based, sequential cue indices", () => {
    const words: TimestampedWord[] = [
      { text: "a", start: 0, end: 0.2 },
      { text: "b", start: 5, end: 5.2 },
      { text: "c", start: 10, end: 10.2 },
    ];
    const cues = groupWordsIntoCues(words);
    expect(cues.map((c) => c.index)).toEqual([1, 2, 3]);
  });
});

describe("cuesToSrt", () => {
  it("renders standard SRT blocks with HH:MM:SS,mmm timestamps", () => {
    const srt = cuesToSrt([
      { index: 1, startS: 0, endS: 1.5, text: "hello there" },
      { index: 2, startS: 2.25, endS: 3.004, text: "friend" },
    ]);
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nhello there\n\n2\n00:00:02,250 --> 00:00:03,004\nfriend\n"
    );
  });

  it("formats an hour-plus timestamp correctly", () => {
    const srt = cuesToSrt([{ index: 1, startS: 3661.25, endS: 3662, text: "late" }]);
    expect(srt.startsWith("1\n01:01:01,250 --> 01:01:02,000\nlate\n")).toBe(true);
  });

  it("returns an empty string for no cues", () => {
    expect(cuesToSrt([])).toBe("");
  });
});
