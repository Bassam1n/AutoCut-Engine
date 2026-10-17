/**
 * Whether a scene's voiceover is already inside its video clip. Video
 * models that take the scene's voiceover as reference audio produce a
 * clip that carries the spoken line (see KieAdapter), so laying the
 * voiceover over it again would double it. Shared by the worker and the
 * browser preview so both play the same sound.
 */
const VOICE_IN_CLIP_MODELS = new Set(["bytedance/seedance-2", "bytedance/seedance-2-5", "kling-3.0/video"]);

export function voiceoverMode(
  video: { source: string | null; created_at: string },
  vo: { created_at: string }
): "separate" | "inClip" {
  return VOICE_IN_CLIP_MODELS.has(video.source ?? "") && vo.created_at < video.created_at ? "inClip" : "separate";
}

/** Newest non-archived asset of a kind for each scene. */
export function latestByScene<T extends { kind: string; scene_id: string | null; version: number; created_at: string }>(rows: T[], kind: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    if (r.kind !== kind || !r.scene_id) continue;
    const cur = out.get(r.scene_id);
    if (!cur || r.version > cur.version || (r.version === cur.version && r.created_at > cur.created_at)) out.set(r.scene_id, r);
  }
  return out;
}
