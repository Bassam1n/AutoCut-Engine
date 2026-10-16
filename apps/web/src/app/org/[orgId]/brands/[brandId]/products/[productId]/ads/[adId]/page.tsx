import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth";
import { getAd } from "../ads-data";
import { getAdScripts } from "../scripts-data";
import { getScenes } from "../scenes-data";
import { getConcept, getCastMembers, getAssetSignedUrls, getBrandCastMembers } from "../concepts-data";
import { getModelOptions } from "@/lib/providers/models-data";
import { getProvidersWithKeys } from "@/app/org/[orgId]/settings/keys/keys-data";
import { getSceneImages, getArchivedSceneImages, getSceneFeedbackImages, getAssetSignedUrlsByPath } from "../scene-images-data";
import {
  getSceneVideos,
  getArchivedSceneVideos,
  getActiveSceneVideoJobs,
  getSceneVoiceovers,
  getActiveSceneVoiceoverJobs,
} from "../scene-videos-data";
import { StudioCanvas } from "./studio-canvas";
import { CostBreakdown } from "./cost-breakdown";
import { getAdSpend, groupSpendByScene } from "../spend-data";
import { getActiveRevision } from "./revision-data";
import { createServiceClient } from "@/lib/supabase/service";
import { recoverUnsavedSceneVideos } from "@/lib/jobs/finalize-scene-video";
import { getVisibleStyles } from "@/app/org/[orgId]/styles/styles-data";

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
        <div className="h-64 animate-pulse rounded-2xl bg-border" />
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
  // Every read below is independent, so they run together: one
  // round trip to the database per stage instead of ~25 in a row.
  const [, ad] = await Promise.all([requireOrgMember(orgId), getAd(orgId, productId, adId)]);
  if (!ad) notFound();

  const [
    scripts,
    scenes,
    concept,
    castMembers,
    brandCastMembers,
    imageModelOptions,
    videoModelOptions,
    // A provider counts as "has a key" if EITHER this brand or the org
    // has one saved, matching get_brand_secret_value's fallback chain.
    providersWithKeys,
    sceneImagesBySceneId,
    archivedSceneImagesBySceneId,
    sceneFeedbackImagesBySceneId,
    sceneVoiceoversBySceneId,
    activeSceneVoiceoverJobsBySceneId,
    adSpend,
    revision,
    visibleStyles,
  ] = await Promise.all([
    getAdScripts(orgId, adId),
    getScenes(orgId, adId),
    getConcept(orgId, adId),
    getCastMembers(orgId, adId),
    getBrandCastMembers(orgId, brandId),
    getModelOptions("image"),
    getModelOptions("video"),
    getProvidersWithKeys(orgId, brandId),
    getSceneImages(orgId, adId),
    getArchivedSceneImages(orgId, adId),
    getSceneFeedbackImages(orgId, adId),
    getSceneVoiceovers(orgId, adId),
    getActiveSceneVoiceoverJobs(orgId, adId),
    getAdSpend(orgId, adId),
    getActiveRevision(orgId, adId),
    getVisibleStyles(orgId),
    // Save any scene video that finished while nobody had this page
    // open, before the video reads below, so a paid generation is never
    // left orphaned.
    recoverUnsavedSceneVideos(createServiceClient(), orgId, adId),
  ]);

  const [sceneVideosBySceneId, archivedSceneVideosBySceneId, activeSceneVideoJobsBySceneId] = await Promise.all([
    getSceneVideos(orgId, adId),
    getArchivedSceneVideos(orgId, adId),
    getActiveSceneVideoJobs(orgId, adId),
  ]);

  const sceneSpendBySceneId = groupSpendByScene(adSpend);

  const assetIds = [
    ...castMembers.flatMap((c) => [c.ref_asset_id, c.sheet_asset_id]),
    ...brandCastMembers.flatMap((c) => [c.ref_asset_id, c.sheet_asset_id]),
  ].filter((id): id is string => id !== null);

  const sceneImagePaths = [
    ...Object.values(sceneImagesBySceneId).flat(),
    ...Object.values(archivedSceneImagesBySceneId).flat(),
    ...Object.values(sceneFeedbackImagesBySceneId).flat(),
  ].map((a) => a.storage_path);

  const voiceoverAssetPaths = Object.values(sceneVoiceoversBySceneId).flatMap((vo) => [
    vo.voAsset.storage_path,
    ...(vo.captionAsset ? [vo.captionAsset.storage_path] : []),
  ]);

  const sceneVideoPaths = [
    ...Object.values(sceneVideosBySceneId).flat(),
    ...Object.values(archivedSceneVideosBySceneId).flat(),
  ].map((a) => a.storage_path);

  const [assetUrls, sceneImageUrls, videoAndVoiceUrls] = await Promise.all([
    getAssetSignedUrls(orgId, assetIds),
    getAssetSignedUrlsByPath(sceneImagePaths),
    getAssetSignedUrlsByPath([...sceneVideoPaths, ...voiceoverAssetPaths]),
  ]);

  // Scene videos needs its own video URLs AND every scene image URL
  // (the "pick which image to animate" picker), plus the voiceover
  // audio/SRT paths, all looked up through one map.
  const sceneVideoUrls = { ...sceneImageUrls, ...videoAndVoiceUrls };

  const styles = visibleStyles
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, preview_image_url: s.preview_image_url }));

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
      brandCastMembers={brandCastMembers}
      assetUrls={assetUrls}
      imageModelOptions={imageModelOptions}
      providersWithKeys={providersWithKeys}
      costBreakdown={<CostBreakdown orgId={orgId} adId={adId} />}
      sceneImagesBySceneId={sceneImagesBySceneId}
      archivedSceneImagesBySceneId={archivedSceneImagesBySceneId}
      sceneFeedbackImagesBySceneId={sceneFeedbackImagesBySceneId}
      sceneImageUrls={sceneImageUrls}
      videoModelOptions={videoModelOptions}
      sceneVideosBySceneId={sceneVideosBySceneId}
      archivedSceneVideosBySceneId={archivedSceneVideosBySceneId}
      activeSceneVideoJobsBySceneId={activeSceneVideoJobsBySceneId}
      sceneVideoUrls={sceneVideoUrls}
      sceneVoiceoversBySceneId={sceneVoiceoversBySceneId}
      activeSceneVoiceoverJobsBySceneId={activeSceneVoiceoverJobsBySceneId}
      sceneSpendBySceneId={sceneSpendBySceneId}
      revision={revision}
      styles={styles}
    />
  );
}
