import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { FalAdapter } from "./fal";
import { ProviderAdapterError } from "./types";

export type GenerateReferenceImageResult =
  | { ok: true; assetId: string; signedUrl: string }
  | { ok: false; error: string };

/**
 * Synchronous inline submit-then-poll for a single reference image.
 * No background job runner exists yet (that's M9) — per a decision
 * made when scoping Concept & cast, generation happens inline inside
 * the triggering server action's request, polling fal.ai in a loop
 * with backoff until the image is ready or a cap is hit. This is
 * swappable for a real async job runner later without changing the
 * caller's contract (still just "give me an asset id back").
 *
 * The resulting image is downloaded from fal.ai's own CDN and
 * re-uploaded into our `renders` Storage bucket rather than kept as
 * a fal.ai URL, so it stays accessible under our own access control
 * and isn't dependent on fal.ai's URL lifetime.
 */
export async function generateReferenceImage(params: {
  orgId: string;
  brandId: string;
  prompt: string;
  referenceImageUrls?: string[];
}): Promise<GenerateReferenceImageResult> {
  const service = createServiceClient();

  const { data: apiKey, error: keyError } = await service.rpc("get_org_secret_value", {
    target_org_id: params.orgId,
    target_provider: "fal",
  });
  if (keyError || !apiKey) {
    return { ok: false, error: "No fal.ai key saved for this org." };
  }

  const adapter = new FalAdapter(apiKey);

  let externalTaskId: string;
  try {
    const submitResult = await adapter.submit({
      kind: "image",
      model: "fal-ai/flux/dev",
      prompt: params.prompt,
      referenceImageUrls: params.referenceImageUrls,
      aspectRatio: undefined,
      extra: { image_size: "portrait_4_3" },
    });
    externalTaskId = submitResult.externalTaskId;
  } catch (err) {
    return { ok: false, error: describeProviderError(err) };
  }

  const MAX_ATTEMPTS = 20;
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
      source: "fal:fal-ai/flux/dev",
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

  return { ok: true, assetId: assetRow.id, signedUrl: signedUrlData.signedUrl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeProviderError(err: unknown): string {
  if (err instanceof ProviderAdapterError) return err.message;
  return err instanceof Error ? err.message : "Image generation failed.";
}
