import { Suspense } from "react";
import { isOrgAdmin, requireOrgMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getModelOptions } from "@/lib/providers/models-data";
import { getProvidersWithKeys } from "../settings/keys/keys-data";
import { getVisibleStyles, getFavouriteStyleIds } from "./styles-data";
import { StyleGallery } from "./style-gallery";

// Preview generation polls the provider inline (up to ~180s).
export const maxDuration = 180;

export default function StylesPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Styles
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Visual styles
        </h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Pick a look for your next ad. Every style has its own masterprompt
          that steers image and video generation.
        </p>
      </div>

      <Suspense fallback={<GallerySkeleton />}>
        <GatedGallery params={params} />
      </Suspense>
    </main>
  );
}

function GallerySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-border" />
      ))}
    </div>
  );
}

async function GatedGallery({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const user = await requireOrgMember(orgId);

  const supabase = await createClient();
  const [styles, favouriteIds, orgAdmin, platformAdmin] = await Promise.all([
    getVisibleStyles(orgId),
    getFavouriteStyleIds(user.id),
    isOrgAdmin(orgId),
    supabase.rpc("is_platform_admin").then((r) => Boolean(r.data)),
  ]);

  // Only people who can set some style's preview need the model list.
  const canPreview = platformAdmin || (orgAdmin && styles.some((s) => s.org_id === orgId));
  const [modelOptions, providersWithKeys] = canPreview
    ? await Promise.all([getModelOptions("image"), getProvidersWithKeys(orgId)])
    : [[], []];

  return (
    <StyleGallery
      orgId={orgId}
      styles={styles}
      favouriteIds={Array.from(favouriteIds)}
      preview={canPreview ? { platformAdmin, orgAdmin, modelOptions, providersWithKeys } : null}
    />
  );
}
