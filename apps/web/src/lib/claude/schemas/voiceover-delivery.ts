import { z } from "zod";

/**
 * Output schema for "suggest_voiceover_delivery" — Voiceover Studio's
 * "Suggest voice + delivery" assist. Scoped deliberately narrow:
 * Claude is asked for a TONE description in words, never a specific
 * ElevenLabs voice_id. Matching "warm, conversational, mid-paced" to
 * one of hundreds of real voices is a listening judgment (timbre,
 * pacing, accent as actually recorded) that text-only Claude has no
 * way to verify against — guessing a voiceId here would look
 * authoritative while being no better than a coin flip. The editor
 * still picks the actual voice from the existing search/preview UI;
 * this only tells them what to listen for.
 */
export const VoiceoverDeliverySchema = z.object({
  tone_description: z
    .string()
    .describe(
      "One short sentence describing the ideal voice tone/delivery for this line, e.g. 'warm, conversational, mid-paced — not hype-y'. Never a specific voice name or voice_id."
    ),
  delivery_script: z
    .string()
    .describe(
      "The scene's line rewritten for spoken delivery, with ElevenLabs-style inline bracketed audio/emotion tags (e.g. [warmly], [laughs], [pause]) added where they help — never changing the actual claims or meaning of the original copy."
    ),
});

export type VoiceoverDelivery = z.infer<typeof VoiceoverDeliverySchema>;
