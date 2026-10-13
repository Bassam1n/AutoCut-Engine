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
 * TWO DISTINCT ElevenLabs endpoints are involved, confirmed via live
 * docs fetch 2026-10-13 after the first version of this file's
 * `voice_type=community` turned out to search the wrong thing:
 *
 * 1. GET /v2/voices — "available voices FOR A USER": the account's own
 *    premade (ElevenLabs' built-in stock set) and any voices already
 *    added to this account's collection. `voice_type=community` here
 *    does NOT search the public library — it only returns library
 *    copies this account has ALREADY added, which is why it came back
 *    empty for a fresh org that's never added one. Used below only
 *    for the "premade" mode.
 *
 * 2. GET /v1/shared-voices — the actual full public voice library
 *    search (confirmed real query params: search/gender/age/accent/
 *    language/sort, where `sort` genuinely supports
 *    `usage_character_count_1y`/`trending`/`cloned_by_count` — a real
 *    server-side popularity sort, unlike /v2/voices). This is what
 *    "community library" in the UI actually searches.
 *
 * A shared-voices result's `voice_id` is NOT directly usable for TTS —
 * ElevenLabs' own "Add shared voice" endpoint description ("Add a
 * shared voice to your collection of Voices") and its example request/
 * response using two DIFFERENT voice_ids confirm a shared voice must
 * be added to the account first, which mints a new, account-scoped
 * voice_id. addSharedVoiceToAccount() below does that add, and the
 * UI calls it the moment an editor selects a community voice — before
 * that selected voice_id is ever sent to generate-voiceover.ts.
 *
 * Both are free, read-only/account-setup calls (not generation calls),
 * so neither goes through claim_paid_job() the way TTS/STT generation
 * does — listing/searching/adding voices costs nothing and isn't a
 * paid action a spend guard needs to gate.
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
  /** Present only for a /v1/shared-voices result — needed by addSharedVoiceToAccount() to add this voice before it can be used for generation. Null for a /v2/voices (premade/already-added) result, which is already directly usable. */
  publicOwnerId: string | null;
};

export type ListVoicesResult =
  | { ok: true; voices: ElevenLabsVoice[]; hasMore: boolean; nextPageToken: string | null }
  | { ok: false; error: string };

export type VoiceSearchFilters = {
  search?: string;
  gender?: string;
  age?: string;
  /** premade (ElevenLabs' own stock library + whatever this account has already added, via /v2/voices) or community (ElevenLabs' full public shared library via /v1/shared-voices — the actual "hundreds of voices" the user asked for). */
  voiceType?: "premade" | "community";
  /** premade: client-side re-sort by liked_by_count (no server-side popularity sort exists on /v2/voices). community: real server-side sort=usage_character_count_1y on /v1/shared-voices. */
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

type RawAccountVoice = {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string | null;
  description?: string | null;
  labels?: { accent?: string; gender?: string; age?: string };
  sharing?: { liked_by_count?: number } | null;
};

type RawSharedVoice = {
  voice_id: string;
  public_owner_id: string;
  name: string;
  category?: string;
  preview_url?: string | null;
  description?: string | null;
  accent?: string;
  gender?: string;
  age?: string;
  cloned_by_count?: number;
};

function fromAccountVoice(v: RawAccountVoice): ElevenLabsVoice {
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
    publicOwnerId: null,
  };
}

function fromSharedVoice(v: RawSharedVoice): ElevenLabsVoice {
  return {
    voiceId: v.voice_id,
    name: v.name,
    category: v.category ?? null,
    previewUrl: v.preview_url ?? null,
    description: v.description ?? null,
    accent: v.accent ?? null,
    gender: v.gender ?? null,
    age: v.age ?? null,
    likedByCount: v.cloned_by_count ?? 0,
    publicOwnerId: v.public_owner_id,
  };
}

/**
 * Searches ElevenLabs' voice catalog. Defaults to `voiceType: "premade"`
 * (the account's own voices via /v2/voices — ElevenLabs' stock set
 * plus anything already added) when no explicit filter is passed, same
 * reasoning as the prior pass's premade-only default. `voiceType:
 * "community"` instead searches /v1/shared-voices — the real full
 * public library — per the user's explicit ask that premade-only was
 * too limiting.
 */
export async function searchElevenLabsVoices(
  orgId: string,
  filters: VoiceSearchFilters = {}
): Promise<ListVoicesResult> {
  await requireOrgMember(orgId);

  const keyResult = await getElevenLabsKey(orgId);
  if (!keyResult.ok) return keyResult;

  if (filters.voiceType === "community") {
    return searchSharedVoices(keyResult.key, filters);
  }
  return searchAccountVoices(keyResult.key, filters);
}

async function searchAccountVoices(apiKey: string, filters: VoiceSearchFilters): Promise<ListVoicesResult> {
  const params = new URLSearchParams();
  params.set("voice_type", "personal");
  params.set("page_size", "100");
  if (filters.search) params.set("search", filters.search);
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.age) params.set("age", filters.age);
  if (filters.nextPageToken) params.set("next_page_token", filters.nextPageToken);

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v2/voices?${params.toString()}`, {
      headers: { "xi-api-key": apiKey },
    });
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs." };
  }

  if (res.status === 401) return { ok: false, error: "Invalid ElevenLabs key." };
  if (!res.ok) return { ok: false, error: `ElevenLabs returned an error (${res.status}).` };

  const body = (await res.json().catch(() => null)) as {
    voices?: RawAccountVoice[];
    has_more?: boolean;
    next_page_token?: string | null;
  } | null;

  if (!body?.voices) return { ok: false, error: "ElevenLabs returned an unexpected response." };

  let voices = body.voices.map(fromAccountVoice);
  if (filters.sortByMostUsed) {
    voices = voices.slice().sort((a, b) => b.likedByCount - a.likedByCount);
  }

  return { ok: true, voices, hasMore: body.has_more ?? false, nextPageToken: body.next_page_token ?? null };
}

/** nextPageToken here is actually a stringified page NUMBER (shared-voices paginates with `page`, not a token — see docblock above) — kept as the same ListVoicesResult.nextPageToken field so the UI's "Load more" logic doesn't need to know which search mode it's continuing. */
async function searchSharedVoices(apiKey: string, filters: VoiceSearchFilters): Promise<ListVoicesResult> {
  const params = new URLSearchParams();
  params.set("page_size", "100");
  params.set("page", filters.nextPageToken ?? "0");
  if (filters.search) params.set("search", filters.search);
  if (filters.gender) params.set("gender", filters.gender);
  if (filters.age) params.set("age", filters.age);
  if (filters.sortByMostUsed) params.set("sort", "usage_character_count_1y");

  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`, {
      headers: { "xi-api-key": apiKey },
    });
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs." };
  }

  if (res.status === 401) return { ok: false, error: "Invalid ElevenLabs key." };
  if (!res.ok) return { ok: false, error: `ElevenLabs returned an error (${res.status}).` };

  const body = (await res.json().catch(() => null)) as {
    voices?: RawSharedVoice[];
    has_more?: boolean;
  } | null;

  if (!body?.voices) return { ok: false, error: "ElevenLabs returned an unexpected response." };

  const voices = body.voices.map(fromSharedVoice);
  const currentPage = Number(filters.nextPageToken ?? "0");

  return {
    ok: true,
    voices,
    hasMore: body.has_more ?? false,
    nextPageToken: body.has_more ? String(currentPage + 1) : null,
  };
}

/**
 * Direct voice_id lookup (user's explicit ask: "by providing the
 * voice id" — e.g. an ID an editor found on ElevenLabs' own voice
 * library website that may never appear in a premade/community search
 * page at all). Tries the account's own voices first (/v2/voices,
 * directly usable as-is), then falls back to a shared-voices search by
 * ID (the only way to look up one specific library voice that isn't
 * already in the account — /v1/shared-voices has no single-ID lookup,
 * so this filters its own search by exact voice_id match).
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
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { voices?: RawAccountVoice[] } | null;
    const raw = body?.voices?.[0];
    if (raw) return { ok: true, voice: fromAccountVoice(raw) };
  }

  // Not in the account's own voices — search the shared library for
  // an exact voice_id match (this endpoint has no single-ID lookup).
  let sharedRes: Response;
  try {
    sharedRes = await fetch(
      `https://api.elevenlabs.io/v1/shared-voices?page_size=100&search=${encodeURIComponent(trimmedId)}`,
      { headers: { "xi-api-key": keyResult.key } }
    );
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs." };
  }
  if (!sharedRes.ok) return { ok: false, error: "No voice found with that ID." };

  const sharedBody = (await sharedRes.json().catch(() => null)) as { voices?: RawSharedVoice[] } | null;
  const match = sharedBody?.voices?.find((v) => v.voice_id === trimmedId);
  if (!match) return { ok: false, error: "No voice found with that ID." };

  return { ok: true, voice: fromSharedVoice(match) };
}

/**
 * Adds a shared-library voice to this org's ElevenLabs account —
 * REQUIRED before a community-library voice_id can be used for TTS
 * generation (see docblock above: ElevenLabs mints a new, different
 * voice_id for the account's own copy). Returns that new voice_id,
 * which is what generate-voiceover.ts must actually be sent, never the
 * original shared-voices voice_id.
 */
export async function addSharedVoiceToAccount(
  orgId: string,
  publicOwnerId: string,
  voiceId: string,
  name: string
): Promise<{ ok: true; voiceId: string } | { ok: false; error: string }> {
  await requireOrgMember(orgId);

  const keyResult = await getElevenLabsKey(orgId);
  if (!keyResult.ok) return keyResult;

  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: { "xi-api-key": keyResult.key, "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: name }),
      }
    );
  } catch {
    return { ok: false, error: "Could not reach ElevenLabs." };
  }

  if (res.status === 401) return { ok: false, error: "Invalid ElevenLabs key." };
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { ok: false, error: `Could not add this voice to your account (${res.status}): ${bodyText.slice(0, 200)}` };
  }

  const body = (await res.json().catch(() => null)) as { voice_id?: string } | null;
  if (!body?.voice_id) return { ok: false, error: "ElevenLabs returned an unexpected response." };

  return { ok: true, voiceId: body.voice_id };
}
