"use server";

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";

/**
 * ElevenLabs voice picker (spec requirement: "select a voice... preview
 * a voice from a list of voices" — the thing the prior pass's
 * hardcoded single voice entirely skipped).
 *
 * GET https://api.elevenlabs.io/v2/voices, header `xi-api-key`.
 * Response shape confirmed: {voices: [{voice_id, name, category,
 * preview_url, description, labels: {accent?, gender?, age?}, ...}],
 * has_more, next_page_token}.
 *
 * This is a free, read-only list call (not a generation call), so it
 * does NOT go through claim_paid_job() the way TTS/STT generation
 * does in generate-voiceover.ts — listing voices costs nothing and
 * isn't a paid action a spend guard needs to gate.
 *
 * The org's ElevenLabs key is fetched the same way every other
 * server-side provider call in this app fetches it: get_org_secret_value()
 * via the service-role client (see generate-reference-image.ts for the
 * exact same pattern from a Next.js server action, as opposed to
 * run-provider-job.ts/generate-voiceover.ts's Trigger.dev-task
 * variant of the same RPC call). The raw key never reaches the
 * browser — only the parsed, non-secret voice list below does.
 */
export type ElevenLabsVoice = {
  voiceId: string;
  name: string;
  category: string | null;
  previewUrl: string | null;
  description: string | null;
  accent: string | null;
  gender: string | null;
  age: string | null;
};

export type ListVoicesResult =
  | { ok: true; voices: ElevenLabsVoice[] }
  | { ok: false; error: string };

/**
 * Default scope: filter to `category === "premade"` only. Reasoning
 * (spec leaves the exact default to this build's judgment, same as
 * the prior pass's voice-id default did): ElevenLabs's /v2/voices
 * response can include "cloned" and "generated" voices the org may
 * have created for unrelated purposes (other products, test clones,
 * professional voice clones tied to a specific person's likeness
 * rights), which aren't appropriate defaults for a brand-new ad's
 * voiceover and would otherwise clutter the first thing an editor
 * sees. "premade" is ElevenLabs's own library of stock voices made
 * available to every account — the safe, generic, no-rights-question
 * default. This is a UI-level filter, not a hidden one: the full list
 * is fetched and `includeAll` lets a caller see every voice the org's
 * account has (e.g. the org's own cloned voices), should that ever be
 * wanted; the editor-facing voiceover step just doesn't expose that
 * toggle in v1, per the spec's scope being "a voice picker," not "a
 * voice-library manager."
 */
export async function listElevenLabsVoices(
  orgId: string,
  options: { includeAll?: boolean } = {}
): Promise<ListVoicesResult> {
  await requireOrgMember(orgId);

  const service = createServiceClient();
  const { data: apiKey, error: keyError } = await service.rpc("get_org_secret_value", {
    target_org_id: orgId,
    target_provider: "elevenlabs",
  });
  if (keyError || !apiKey) {
    return { ok: false, error: "No ElevenLabs key saved for this org. Add one in Settings > Keys." };
  }

  let res: Response;
  try {
    res = await fetch("https://api.elevenlabs.io/v2/voices", {
      headers: { "xi-api-key": apiKey },
    });
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs." };
  }

  if (res.status === 401) return { ok: false, error: "Invalid ElevenLabs key." };
  if (!res.ok) return { ok: false, error: `ElevenLabs returned an error (${res.status}).` };

  const body = (await res.json().catch(() => null)) as {
    voices?: {
      voice_id: string;
      name: string;
      category?: string;
      preview_url?: string | null;
      description?: string | null;
      labels?: { accent?: string; gender?: string; age?: string };
    }[];
  } | null;

  if (!body?.voices) return { ok: false, error: "ElevenLabs returned an unexpected response." };

  const voices: ElevenLabsVoice[] = body.voices
    .filter((v) => options.includeAll || v.category === "premade")
    .map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category ?? null,
      previewUrl: v.preview_url ?? null,
      description: v.description ?? null,
      accent: v.labels?.accent ?? null,
      gender: v.labels?.gender ?? null,
      age: v.labels?.age ?? null,
    }));

  return { ok: true, voices };
}
