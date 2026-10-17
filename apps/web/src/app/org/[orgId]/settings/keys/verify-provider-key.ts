import "server-only";
import type { ApiKeyProvider } from "./keys-data";

export type VerifyResult = { ok: true } | { ok: false; error: string };

/**
 * Makes a real, cheap authenticated call to each provider to confirm
 * the key works before it's saved, per spec §5.1 ("Key screens are
 * write-only... test the key with a cheap call before saving").
 * Server-only — the raw key value must never reach the browser or a
 * client log. Callers must not log the `key` argument.
 *
 * Endpoint confidence, from research done before writing this:
 * - anthropic: official docs, zero-cost (GET /v1/models).
 * - elevenlabs: confirmed against Hermes's own working production
 *   integration (GET /v1/user, xi-api-key header).
 * - twelvelabs: confirmed header format from Hermes's own working
 *   production integration; endpoint is a cheap paginated list call.
 * - pexels: confirmed against Hermes's own working production
 *   integration (Authorization: <raw key>, no Bearer prefix). Costs
 *   1 of 20,000/month requests — the cheapest confirmed call.
 * - kie: secondary-source endpoint (not kie.ai's own docs directly),
 *   best effort.
 * - fal: official docs path, used purely as an auth probe (a pricing
 *   lookup, not a generation call), best effort.
 */
export async function verifyProviderKey(
  provider: ApiKeyProvider,
  key: string
): Promise<VerifyResult> {
  try {
    switch (provider) {
      case "anthropic":
        return await verifyAnthropic(key);
      case "elevenlabs":
        return await verifyElevenLabs(key);
      case "twelvelabs":
        return await verifyTwelveLabs(key);
      case "pexels":
        return await verifyPexels(key);
      case "kie":
        return await verifyKie(key);
      case "fal":
        return await verifyFal(key);
    }
  } catch {
    return { ok: false, error: "Could not reach the provider. Try again." };
  }
}

async function verifyAnthropic(key: string): Promise<VerifyResult> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  if (res.status === 401) return { ok: false, error: "Invalid API key." };
  if (!res.ok) return { ok: false, error: `Anthropic returned an error (${res.status}).` };
  return { ok: true };
}

async function verifyElevenLabs(key: string): Promise<VerifyResult> {
  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": key },
  });
  if (res.status === 401) return { ok: false, error: "Invalid API key." };
  if (!res.ok) return { ok: false, error: `ElevenLabs returned an error (${res.status}).` };
  return { ok: true };
}

async function verifyTwelveLabs(key: string): Promise<VerifyResult> {
  const res = await fetch("https://api.twelvelabs.io/v1.3/indexes", {
    headers: { "x-api-key": key },
  });
  if (res.status === 401 || res.status === 403) return { ok: false, error: "Invalid API key." };
  if (!res.ok) return { ok: false, error: `TwelveLabs returned an error (${res.status}).` };
  return { ok: true };
}

async function verifyPexels(key: string): Promise<VerifyResult> {
  const res = await fetch("https://api.pexels.com/v1/search?query=test&per_page=1", {
    headers: { Authorization: key },
  });
  if (res.status === 401) return { ok: false, error: "Invalid API key." };
  if (!res.ok) return { ok: false, error: `Pexels returned an error (${res.status}).` };
  return { ok: true };
}

async function verifyKie(key: string): Promise<VerifyResult> {
  // kie.ai always answers with HTTP 200 — auth failure is reported
  // inside the JSON body as `code: 401`, not as the HTTP status.
  // Confirmed against the live API with a garbage key before relying
  // on this (the HTTP-status check alone silently accepted any key).
  const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) return { ok: false, error: `kie.ai returned an error (${res.status}).` };

  const body = (await res.json().catch(() => null)) as { code?: number } | null;
  if (body?.code === 401) return { ok: false, error: "Invalid API key." };
  if (body?.code !== 200 && body?.code !== undefined) {
    return { ok: false, error: `kie.ai returned an error (code ${body.code}).` };
  }
  return { ok: true };
}

async function verifyFal(key: string): Promise<VerifyResult> {
  const res = await fetch(
    "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev",
    { headers: { Authorization: `Key ${key}` } }
  );
  if (res.status === 401 || res.status === 403) return { ok: false, error: "Invalid API key." };
  if (!res.ok) return { ok: false, error: `fal.ai returned an error (${res.status}).` };
  return { ok: true };
}
