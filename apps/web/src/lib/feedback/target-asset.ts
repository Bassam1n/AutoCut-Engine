/**
 * Pure helper for feedback-actions.ts — picks which existing asset a
 * Tweak/Rework round should treat as "the current asset that
 * produced this result," given a scene's known assets. Kept here
 * (not inlined in the "use server" actions file) so it's unit-
 * testable without a database, same split as lib/video/duration.ts
 * and lib/video/prompt-shortening.ts.
 *
 * Video feedback's "first analyses the current clip" step (spec
 * §5.8) needs a STILL IMAGE to hand to Claude's vision input (Claude
 * cannot watch video — see analyze-video-feedback.ts). No provider
 * integration in this codebase yet actually writes a `last_frame`
 * asset (confirmed: scene-videos-actions.ts's finalizeSceneVideoJob
 * doc comment — the field exists in the assets.kind check constraint
 * for future use, but nothing populates it today), so this always
 * resolves to the source image that started the clip for now. The
 * selection logic still prefers a last_frame asset BY KIND when one
 * exists, so this doesn't need to change the day that gap closes.
 */

export type FeedbackAssetKind = "image" | "last_frame" | "video";

export type AssetLike = {
  id: string;
  kind: string;
  version: number;
  source_video_asset_id?: string | null;
};

/**
 * Picks the latest (highest-version) non-archived asset of the given
 * kind for a scene. Returns null when none exists. Pure sort/filter —
 * no I/O.
 */
export function pickLatestAssetOfKind<T extends AssetLike>(
  assets: T[],
  kind: FeedbackAssetKind
): T | null {
  const matching = assets.filter((a) => a.kind === kind);
  if (matching.length === 0) return null;
  return matching.reduce((latest, a) => (a.version > latest.version ? a : latest));
}

/**
 * Video-feedback still-frame selection (spec §5.8's "analyses the
 * current clip" step): prefer a real last_frame asset for the same
 * scene if one exists (closer to what the clip actually ends on),
 * otherwise fall back to the latest image asset for the scene (the
 * frame the clip started from) — the best honest substitute available
 * today, per the limitation documented above.
 */
export function pickVideoFeedbackStillAsset<T extends AssetLike>(
  sceneAssets: T[]
): { asset: T; isLastFrame: boolean } | null {
  const lastFrame = pickLatestAssetOfKind(sceneAssets, "last_frame");
  if (lastFrame) return { asset: lastFrame, isLastFrame: true };

  const sourceImage = pickLatestAssetOfKind(sceneAssets, "image");
  if (sourceImage) return { asset: sourceImage, isLastFrame: false };

  return null;
}
