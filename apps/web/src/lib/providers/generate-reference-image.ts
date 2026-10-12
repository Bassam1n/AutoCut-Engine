import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { FalAdapter } from "./fal";
import { KieAdapter } from "./kie";
import { ProviderAdapterError, type ProviderAdapter } from "./types";
import { spendLimitMessage } from "@/lib/spend-limit-message";

export type GenerateReferenceImageResult =
  | { ok: true; assetId: string; signedUrl: string }
  | { ok: false; error: string }
  | { ok: false; error: string; code: "KEY_MISSING"; provider: string }
  | { ok: false; error: string; code: "SPEND_LIMIT" };

/**
 * Synchronous inline submit-then-poll for a single reference image.
 * No background job runner exists yet (that's M9) — per a decision
 * made when scoping Concept & cast, generation happens inline inside
 * the triggering server action's request, polling the chosen
 * provider in a loop with a fixed delay until the image is ready or
 * a cap is hit. This is swappable for a real async job runner later
 * without changing the caller's contract (still just "give me an
 * asset id back").
 *
 * Provider/model is caller-chosen (the model picker) rather than
 * hardcoded to fal/flux-dev, per the user's request — kie.ai covers
 * most image models an org might want, fal.ai covers the rest, and
 * which one has a usable key varies per org.
 *
 * The resulting image is downloaded from the provider's own CDN and
 * re-uploaded into our `renders` Storage bucket rather than kept as
 * a provider URL, so it stays accessible under our own access control
 * and isn't dependent on that provider's URL lifetime.
 */
export async function generateReferenceImage(params: {
  orgId: string;
  brandId: string;
  prompt: string;
  referenceImageUrls?: string[];
  provider: "fal" | "kie";
  endpoint: string;
  extra?: Record<string, unknown>;
  /** Ad this generation is attributed to for cost breakdown, when it has one — cast reference generation is triggered from inside an ad's Studio flow even though the resulting asset is brand-scoped, not ad-scoped. */
  attributedAdId?: string;
  /** spend_events.kind — identifies which pipeline step this generation belongs to on the cost breakdown. */
  spendKind: string;
}): Promise<GenerateReferenceImageResult> {
  const service = createServiceClient();

  // Same guard llm.call() uses before spending anything — image
  // generation was missing this entirely until the previous pass,
  // meaning a paused org could still generate images even though it
  // couldn't run a Claude call. claim_paid_job()'s raw "org_paused:
  // ..." exception string is translated to plain language here
  // rather than passed straight through — see spend-limit-message.ts
  // for why.
  const { error: claimError } = await service.rpc("claim_paid_job", {
    target_org_id: params.orgId,
  });
  if (claimError) {
    return { ok: false, error: spendLimitMessage(claimError.message), code: "SPEND_LIMIT" };
  }

  const { data: apiKey, error: keyError } = await service.rpc("get_org_secret_value", {
    target_org_id: params.orgId,
    target_provider: params.provider,
  });
  if (keyError || !apiKey) {
    return {
      ok: false,
      error: `No ${params.provider} key saved for this org.`,
      code: "KEY_MISSING",
      provider: params.provider,
    };
  }

  const adapter: ProviderAdapter = params.provider === "kie" ? new KieAdapter(apiKey) : new FalAdapter(apiKey);

  let externalTaskId: string;
  try {
    const submitResult = await adapter.submit({
      kind: "image",
      model: params.endpoint,
      prompt: params.prompt,
      referenceImageUrls: params.referenceImageUrls,
      extra: params.extra,
    });
    externalTaskId = submitResult.externalTaskId;
  } catch (err) {
    return { ok: false, error: describeProviderError(err) };
  }

  // 90 attempts * 2s = 180s cap. The original 20-attempt (40s) cap was
  // sized for a single fast request; scene-image generation can run
  // several of these concurrently (Generate All's ~1s stagger) and
  // some models are genuinely slower than others, so 40s was timing
  // out real, still-in-progress generations rather than actually-stuck
  // ones. Paired with maxDuration on the calling server actions so the
  // platform's own function timeout doesn't cut this off first.
  const MAX_ATTEMPTS = 90;
  const POLL_DELAY_MS = 2000;
  let resultUrl: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_DELAY_MS);

    let poll;
    try {
      poll = await adapter.poll(externalTaskId);
    } catch (err) {
      return { ok: false, error: describeProviderError(err) };
    }

    if (poll.status === "succeeded") {
      resultUrl = poll.resultUrls?.[0] ?? null;
      break;
    }
    if (poll.status === "failed") {
      return { ok: false, error: poll.errorMessage ?? "Image generation failed." };
    }
  }

  if (!resultUrl) {
    return { ok: false, error: "Image generation timed out." };
  }

  const imageRes = await fetch(resultUrl);
  if (!imageRes.ok) {
    return { ok: false, error: "Could not download the generated image." };
  }
  const imageBytes = await imageRes.arrayBuffer();

  const storagePath = `${params.orgId}/brand_cast/${params.brandId}/${Date.now()}.png`;
  const { error: uploadError } = await service.storage
    .from("renders")
    .upload(storagePath, imageBytes, { contentType: "image/png" });
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  const { data: assetRow, error: assetError } = await service
    .from("assets")
    .insert({
      org_id: params.orgId,
      brand_id: params.brandId,
      ad_id: null,
      kind: "image",
      storage_path: storagePath,
      source: `${params.provider}:${params.endpoint}`,
    })
    .select("id")
    .single();
  if (assetError) {
    return { ok: false, error: assetError.message };
  }

  const { data: signedUrlData, error: signError } = await service.storage
    .from("renders")
    .createSignedUrl(storagePath, 3600);
  if (signError || !signedUrlData) {
    return { ok: false, error: signError?.message ?? "Could not sign the generated image's URL." };
  }

  // Recorded after the asset exists, same ordering as llm.call() —
  // spend reflects work actually done, never charged for a failed
  // attempt. price_table (supabase/seed_price_table.sql) holds the
  // per-image estimate; 0 if it's ever missing rather than throwing,
  // since a pricing-table gap shouldn't block a successful generation.
  const { data: price } = await service
    .from("price_table")
    .select("usd")
    .eq("provider", params.provider)
    .eq("model", params.endpoint)
    .eq("unit", "per_image")
    .maybeSingle();

  await service.rpc("record_spend_event", {
    target_org_id: params.orgId,
    target_ad_id: params.attributedAdId ?? null,
    target_provider: params.provider,
    target_model: params.endpoint,
    target_usd_est: price?.usd ?? 0,
    target_kind: params.spendKind,
  });

  return { ok: true, assetId: assetRow.id, signedUrl: signedUrlData.signedUrl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeProviderError(err: unknown): string {
  if (err instanceof ProviderAdapterError) return err.message;
  return err instanceof Error ? err.message : "Image generation failed.";
}
