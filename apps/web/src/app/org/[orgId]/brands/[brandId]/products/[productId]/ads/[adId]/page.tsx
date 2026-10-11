import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth";
import { getAd } from "../ads-data";
import { getAdScripts } from "../scripts-data";
import { getScenes } from "../scenes-data";
import { getConcept, getCastMembers, getAssetSignedUrls } from "../concepts-data";
import { getModelOptions } from "@/lib/providers/models-data";
import { getOrgSecrets } from "@/app/org/[orgId]/settings/keys/keys-data";
import { StudioCanvas } from "./studio-canvas";
import { CostBreakdown } from "./cost-breakdown";

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
  const secrets = await getOrgSecrets(orgId);
  const providersWithKeys = secrets.map((s) => s.provider);

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
    />
  );
}
