import { z } from "zod";

/**
 * Output schema for "plan_video_motion" — spec §5.7's motion
 * preflight: "Before any paid call, a motion preflight Claude call
 * checks that the image can physically perform the requested motion,
 * locks visible people, hands, objects and product details, plans
 * one continuous action with a reachable end state, and stops with a
 * plain message if the image contradicts the request or already
 * shows the end state (offer to animate what the moment can still
 * do)." This is a vision call (the scene image goes in via
 * LlmCallParams.imageUrls) run BEFORE any paid provider call —
 * scene-videos-actions.ts's generateSceneVideo() checks
 * `is_plausible` and stops entirely (no provider call, no spend) when
 * it's false and no fallback_motion_plan exists either.
 *
 * Deliberately two possible "ok" shapes rather than a single boolean:
 * is_plausible=true always carries a motion_plan (the literal action
 * to animate); is_plausible=false may still carry a
 * fallback_motion_plan (spec: "offer to animate what the moment can
 * still do") — only when truly nothing in the frame is animatable is
 * fallback_motion_plan left null, and that's the one case the UI
 * shows a plain stop message with no retry path.
 */
export const PlanVideoMotionSchema = z.object({
  is_plausible: z
    .boolean()
    .describe(
      "True only if the image can physically perform the requested motion as asked: visible people/hands/objects/product details stay locked and consistent, the action is one continuous motion, and it has a reachable end state within a short clip. False if the image contradicts the request, already shows the requested end state, or the motion would require inventing something the image doesn't support."
    ),
  motion_plan: z
    .string()
    .nullable()
    .describe(
      "When is_plausible is true: a concrete, literal description of the one continuous action to animate, written for a video-prompt writer to turn into a final prompt. Null when is_plausible is false."
    ),
  reason: z
    .string()
    .nullable()
    .describe(
      "When is_plausible is false: a short, plain-language (no jargon) explanation of why this motion can't be made from this image, shown directly to the editor. Null when is_plausible is true."
    ),
  fallback_motion_plan: z
    .string()
    .nullable()
    .describe(
      "When is_plausible is false but the frame still supports SOME motion worth animating: a concrete alternative action the editor can accept instead (spec: 'offer to animate what the moment can still do'). Null when is_plausible is true, or when truly nothing in the frame is animatable."
    ),
});

export type PlanVideoMotion = z.infer<typeof PlanVideoMotionSchema>;
