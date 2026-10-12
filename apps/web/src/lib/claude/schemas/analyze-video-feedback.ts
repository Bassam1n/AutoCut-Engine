import { z } from "zod";

/**
 * Output schema for "analyze_video_feedback" — spec §5.8: "Video
 * feedback first analyses the current clip, then rewrites the video
 * prompt as a change against what the clip does."
 *
 * HONEST LIMITATION (confirmed via the claude-api skill before this
 * was designed): Claude's vision input accepts images, not video —
 * there is no "watch this video" capability on the Messages API, and
 * this app does not fabricate one. "Analyses the current clip" is
 * implemented as a vision call over the clip's LAST FRAME (the
 * video's own `last_frame` asset when the provider produced one,
 * else the source image that started the clip) via the existing
 * imageUrls wiring in llm.call()/LlmCallParams — the same mechanism
 * plan_video_motion already uses for a still image. This call never
 * sees motion, audio, or mid-clip content; it describes what the
 * available still shows and what it can infer the clip most likely
 * depicts, then the caller feeds that description plus the feedback
 * text into write_video_prompt as "what the clip currently does" context.
 */
export const AnalyzeVideoFeedbackSchema = z.object({
  current_clip_description: z
    .string()
    .describe(
      "A description of what this video clip currently shows and does, inferred from the available still frame plus the scene's known motion plan/copy context — written as 'what the clip does' for a prompt writer to treat as the baseline to change against. Explicitly note any uncertainty where the still alone can't confirm something about the motion."
    ),
});

export type AnalyzeVideoFeedback = z.infer<typeof AnalyzeVideoFeedbackSchema>;
