"use server";

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgMember } from "@/lib/auth";

/**
 * ElevenLabs voice picker (spec requirement: "select a voice... preview
 * a voice from a list of voices," extended per the user's explicit
 * follow-up: search/filter by gender/age, reach the full shared voice
 * library (not just premade), sort by popularity, and look a voice up
 * directly by voice_id).
 *
 * GET https://api.elevenlabs.io/v2/voices, header `xi-api-key`.
 * Confirmed query params (live docs fetch 2026-10-13):
 * `search`, `voice_type` (premade/community/personal/workspace/saved/
 * non-community), `category`, `gender`, `age`, `accent`, `voice_ids`
 * (direct lookup, comma or repeated — up to 100), `page_size` (max
 * 100), `next_page_token`. No server-side popularity/"most used" sort
 * exists — `sort` only accepts `created_at_unix`/`name` — so "most
 * used" is done client-side in this file, by re-ordering the fetched
 * page using each voice's own `sharing.liked_by_count` (ElevenLabs's
 * own popularity signal, returned in the response body already).
 * This is an approximation over whatever page was fetched, not a true
 * full-library popularity rank — there is no endpoint that provides
 * one.
 *
 * This is a free, read-only list call (not a generation call), so it
 * does NOT go through claim_paid_job() the way TTS/STT generation
 * does in generate-voiceover.ts — listing/searching voices costs
 * nothing and isn't a paid action a spend guard needs to gate.
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
  likedByCount: number;
};

export type ListVoicesResult =
  | { ok: true; voices: ElevenLabsVoice[]; hasMore: boolean; nextPageToken: string | null }
  | { ok: false; error: string };

export type VoiceSearchFilters = {
  search?: string;
  gender?: string;
  age?: string;
  /** premade (ElevenLabs' stock library, this step's default) or community (the full public shared library, scoped per the user's explicit ask — hundreds of voices, not just the small premade set). */
  voiceType?: "premade" | "community";
  /** Re-sorts the fetched page by sharing.liked_by_count descending — see docblock above for why this can't be a true full-library popularity rank. */
  sortByMostUsed?: boolean;
  nextPageToken?: string;
};

async function getElevenLabsKey(orgId: string): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const service = createServiceClient();
  const { data: apiKey, error: keyError } = await service.rpc("get_org_secret_value", {
    target_org_id: orgId,
    target_provider: "elevenlabs",
  });
  if (keyError || !apiKey) {
    return { ok: false, error: "No ElevenLabs key saved for this org. Add one in Settings > Keys." };
  }
  return { ok: true, key: apiKey };
}

type RawVoice = {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string | null;
  description?: string | null;
  labels?: { accent?: string; gender?: string; age?: string };
  sharing?: { liked_by_count?: number } | null;
};

function toElevenLabsVoice(v: RawVoice): ElevenLabsVoice {
  return {
    voiceId: v.voice_id,
    name: v.name,
    category: v.category ?? null,
    previewUrl: v.preview_url ?? null,
    description: v.description ?? null,
    accent: v.labels?.accent ?? null,
    gender: v.labels?.gender ?? null,
    age: v.labels?.age ?? null,
    likedByCount: v.sharing?.liked_by_count ?? 0,
  };
}

/**
 * Searches ElevenLabs' voice catalog. Defaults to `voice_type=premade`
 * (ElevenLabs' own no-rights-question stock library) when no explicit
 * voiceType filter is passed, same reasoning as the prior pass's
 * premade-only default — switching to `community` is the editor's own
 * explicit choice (a toggle in the UI), not a silent default, since
 * community voices can carry different usage terms.
 */
export async function searchElevenLabsVoices(
  orgId: string,
  filters: VoiceSearchFilters = {}
): Promise<ListVoicesResult> {
  await requireOrgMember(orgId);

  const keyResult = await getElevenLabsKey(orgId);
  if (!keyResult.ok) return keyResult;

  const params = new URLSearchParams();
  params.set("voice_type", filters.voiceType ?? "premade");
  params.set("page_size", "100");
  if (filters.search) params.set("search", filters.search);
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.age) params.set("age", filters.age);
  if (filters.nextPageToken) params.set("next_page_token", filters.nextPageToken);

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v2/voices?${params.toString()}`, {
      headers: { "xi-api-key": keyResult.key },
    });
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs." };
  }

  if (res.status === 401) return { ok: false, error: "Invalid ElevenLabs key." };
  if (!res.ok) return { ok: false, error: `ElevenLabs returned an error (${res.status}).` };

  const body = (await res.json().catch(() => null)) as {
    voices?: RawVoice[];
    has_more?: boolean;
    next_page_token?: string | null;
  } | null;

  if (!body?.voices) return { ok: false, error: "ElevenLabs returned an unexpected response." };

  let voices = body.voices.map(toElevenLabsVoice);
  if (filters.sortByMostUsed) {
    voices = voices.slice().sort((a, b) => b.likedByCount - a.likedByCount);
  }

  return { ok: true, voices, hasMore: body.has_more ?? false, nextPageToken: body.next_page_token ?? null };
}

/**
 * Direct voice_id lookup (user's explicit ask: "by providing the
 * voice id" — e.g. an ID an editor found on ElevenLabs' own voice
 * library website that may never appear in a premade/community search
 * page at all). Same endpoint, `voice_ids` param instead of filters.
 */
export async function getElevenLabsVoiceById(
  orgId: string,
  voiceId: string
): Promise<{ ok: true; voice: ElevenLabsVoice } | { ok: false; error: string }> {
  await requireOrgMember(orgId);

  const trimmedId = voiceId.trim();
  if (!trimmedId) return { ok: false, error: "Enter a voice ID." };

  const keyResult = await getElevenLabsKey(orgId);
  if (!keyResult.ok) return keyResult;

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v2/voices?voice_ids=${encodeURIComponent(trimmedId)}`, {
      headers: { "xi-api-key": keyResult.key },
    });
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs." };
  }

  if (res.status === 401) return { ok: false, error: "Invalid ElevenLabs key." };
  if (!res.ok) return { ok: false, error: `ElevenLabs returned an error (${res.status}).` };

  const body = (await res.json().catch(() => null)) as { voices?: RawVoice[] } | null;
  const raw = body?.voices?.[0];
  if (!raw) return { ok: false, error: "No voice found with that ID." };

  return { ok: true, voice: toElevenLabsVoice(raw) };
}
