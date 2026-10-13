import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth";
import { getAd } from "../ads-data";
import { getAdScripts } from "../scripts-data";
import { getScenes } from "../scenes-data";
import { getConcept, getCastMembers, getAssetSignedUrls } from "../concepts-data";
import { getModelOptions } from "@/lib/providers/models-data";
import { getOrgSecrets } from "@/app/org/[orgId]/settings/keys/keys-data";
import { getSceneImages, getSceneFeedbackImages, getAssetSignedUrlsByPath } from "../scene-images-data";
import { getSceneVideos, getArchivedSceneVideos, getActiveSceneVideoJobs, getLatestAdVoiceover } from "../scene-videos-data";
import { StudioCanvas } from "./studio-canvas";
import { CostBreakdown } from "./cost-breakdown";

// Scene-image generation (scene-images-actions.ts) polls a provider
// synchronously and can run well past Vercel's default function
// timeout, especially with several scenes generating concurrently via
// Generate All's ~1s stagger — raised to match generate-reference-
// image.ts's poll-loop cap (90 attempts * 2s = 180s).
export const maxDuration = 180;

export default function AdStudioPage({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string; adId: string }>;
}) {
  return (
    <Suspense fallback={<CanvasSkeleton />}>
      <GatedCanvas params={params} />
    </Suspense>
  );
}

function CanvasSkeleton() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-12 animate-pulse border-b border-border bg-border/20" />
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <div className="h-64 animate-pulse rounded-xl bg-border" />
      </div>
    </div>
  );
}

async function GatedCanvas({
  params,
}: {
  params: Promise<{ orgId: string; brandId: string; productId: string; adId: string }>;
}) {
  const { orgId, brandId, productId, adId } = await params;
  await requireOrgMember(orgId);

  const ad = await getAd(orgId, productId, adId);
  if (!ad) notFound();

  const scripts = await getAdScripts(orgId, adId);
  const scenes = await getScenes(orgId, adId);
  const concept = await getConcept(orgId, adId);
  const castMembers = await getCastMembers(orgId, adId);

  const assetIds = castMembers
    .flatMap((c) => [c.ref_asset_id, c.sheet_asset_id])
    .filter((id): id is string => id !== null);
  const assetUrls = await getAssetSignedUrls(orgId, assetIds);

  const imageModelOptions = await getModelOptions("image");
  const videoModelOptions = await getModelOptions("video");
  const secrets = await getOrgSecrets(orgId);
  const providersWithKeys = secrets.map((s) => s.provider);

  const sceneImagesBySceneId = await getSceneImages(orgId, adId);
  const sceneFeedbackImagesBySceneId = await getSceneFeedbackImages(orgId, adId);
  const sceneVideosBySceneId = await getSceneVideos(orgId, adId);
  const archivedSceneVideosBySceneId = await getArchivedSceneVideos(orgId, adId);
  const activeSceneVideoJobsBySceneId = await getActiveSceneVideoJobs(orgId, adId);

  const sceneImagePaths = [
    ...Object.values(sceneImagesBySceneId).flat(),
    ...Object.values(sceneFeedbackImagesBySceneId).flat(),
  ].map((a) => a.storage_path);
  const sceneImageUrls = await getAssetSignedUrlsByPath(sceneImagePaths);

  const adVoiceover = await getLatestAdVoiceover(orgId, adId);

  const sceneVideoPaths = [
    ...Object.values(sceneVideosBySceneId).flat(),
    ...Object.values(archivedSceneVideosBySceneId).flat(),
    ...(adVoiceover ? [adVoiceover.voAsset, ...(adVoiceover.captionAsset ? [adVoiceover.captionAsset] : [])] : []),
  ].map((a) => a.storage_path);
  // Scene videos needs both its own video asset URLs AND every scene
  // image URL (the "pick which image to animate" picker) — merged
  // into one signed-URL map so scene-videos-step.tsx can look either
  // kind of asset's storage_path up through a single prop. The
  // voiceover audio/SRT paths ride along in the same map rather than
  // a separate one, since VoiceoverPanel is rendered from within
  // scene-videos-step.tsx and already receives this prop.
  const sceneVideoUrls = {
    ...sceneImageUrls,
    ...(await getAssetSignedUrlsByPath(sceneVideoPaths)),
  };

  return (
    <StudioCanvas
      orgId={orgId}
      brandId={brandId}
      productId={productId}
      ad={ad}
      scripts={scripts}
      scenes={scenes}
      concept={concept}
      castMembers={castMembers}
      assetUrls={assetUrls}
      imageModelOptions={imageModelOptions}
      providersWithKeys={providersWithKeys}
      costBreakdown={<CostBreakdown orgId={orgId} adId={adId} />}
      sceneImagesBySceneId={sceneImagesBySceneId}
      sceneFeedbackImagesBySceneId={sceneFeedbackImagesBySceneId}
      sceneImageUrls={sceneImageUrls}
      videoModelOptions={videoModelOptions}
      sceneVideosBySceneId={sceneVideosBySceneId}
      archivedSceneVideosBySceneId={archivedSceneVideosBySceneId}
      activeSceneVideoJobsBySceneId={activeSceneVideoJobsBySceneId}
      sceneVideoUrls={sceneVideoUrls}
      adVoiceover={adVoiceover}
    />
  );
}
