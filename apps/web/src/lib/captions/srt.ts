/**
 * SRT caption export from ElevenLabs word-level timestamps (spec
 * §5.4 bullet 5: "Word-level timestamps from speech-to-text drive
 * caption timing... a downloadable SRT"). This pass is SRT-export
 * only — no burned-in captions, no safe-zone positioning (both
 * explicitly out of scope for this change; they're meaningless
 * without a render step, which doesn't exist yet).
 *
 * Pure, dependency-free functions so they're unit-testable without a
 * database, a provider call, or an audio file in the loop — the
 * generate-voiceover Trigger.dev task is the only real caller.
 *
 * Input shape matches ElevenLabs STT's response words[] array
 * directly (confirmed contract: {text, start, end, type, ...}),
 * already filtered by the caller to type === "word" (STT also
 * returns "spacing" and "audio_event" entries, which carry no
 * caption text and would otherwise show up as empty/garbage cues).
 */

export type TimestampedWord = {
  text: string;
  /** Seconds, float. */
  start: number;
  /** Seconds, float. */
  end: number;
};

export type CaptionCue = {
  /** 1-based, matching SRT's own numbering convention. */
  index: number;
  startS: number;
  endS: number;
  text: string;
};

export type CueGroupingOptions = {
  /** A gap this long or longer between two consecutive words starts a new cue — mirrors a natural speech pause, which is also usually a sensible place to cut a caption line. Default 0.6s matches common caption-tooling defaults (e.g. YouTube auto-captions break at a similar silence threshold). */
  maxPauseS?: number;
  /** Hard cap on how many words one cue may hold, independent of pauses — keeps a long, pause-free run of speech from becoming one giant unreadable caption line. Default 8, in the commonly recommended 6-10 words/line range for short-form vertical video captions. */
  maxWordsPerCue?: number;
  /** Hard cap on one cue's total duration in seconds, independent of word count — a cue of long, slowly-spoken words could stay under maxWordsPerCue yet still sit on screen too long for a viewer to track. Default 7s. */
  maxDurationS?: number;
};

const DEFAULT_OPTIONS: Required<CueGroupingOptions> = {
  maxPauseS: 0.6,
  maxWordsPerCue: 8,
  maxDurationS: 7,
};

/**
 * Groups word-level timestamps into caption cues. Heuristic (in this
 * exact priority order, matching how real caption tooling typically
 * segments speech):
 *
 * 1. Pause break: if the gap since the previous word's end is >=
 *    maxPauseS, start a new cue at this word — pauses are usually
 *    sentence/clause boundaries, the most natural place to cut.
 * 2. Word-count cap: once the current cue already holds
 *    maxWordsPerCue words, start a new cue regardless of pause —
 *    prevents a long pause-free run from becoming unreadable.
 * 3. Duration cap: once adding this word would make the current
 *    cue's span (first word's start to this word's end) exceed
 *    maxDurationS, start a new cue — prevents a cue of long, slow
 *    words from lingering on screen too long even if word count is
 *    still under the cap.
 *
 * Checked in that order per word so whichever limit is hit first
 * wins — e.g. a cue that's already at the word cap still breaks even
 * if there's no pause, and a cue under the word cap but already at
 * the duration cap still breaks too.
 */
export function groupWordsIntoCues(
  words: TimestampedWord[],
  options: CueGroupingOptions = {}
): CaptionCue[] {
  const { maxPauseS, maxWordsPerCue, maxDurationS } = { ...DEFAULT_OPTIONS, ...options };

  const cues: CaptionCue[] = [];
  let current: TimestampedWord[] = [];

  function flush() {
    if (current.length === 0) return;
    cues.push({
      index: cues.length + 1,
      startS: current[0].start,
      endS: current[current.length - 1].end,
      text: current.map((w) => w.text).join(" "),
    });
    current = [];
  }

  for (const word of words) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      const pauseS = word.start - previous.end;
      const wouldExceedDuration = word.end - current[0].start > maxDurationS;

      if (pauseS >= maxPauseS || current.length >= maxWordsPerCue || wouldExceedDuration) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  return cues;
}

/** Formats seconds as SRT's "HH:MM:SS,mmm" timestamp. */
function formatSrtTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);

  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/** Renders caption cues into standard .srt file text. */
export function cuesToSrt(cues: CaptionCue[]): string {
  return cues
    .map(
      (cue) =>
        `${cue.index}\n${formatSrtTimestamp(cue.startS)} --> ${formatSrtTimestamp(cue.endS)}\n${cue.text}\n`
    )
    .join("\n");
}
