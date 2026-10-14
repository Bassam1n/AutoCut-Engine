import { Suspense } from "react";
import { requirePlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getModelOptions } from "@/lib/providers/models-data";
import { getProvidersWithKeys } from "@/app/org/[orgId]/settings/keys/keys-data";
import { getFavouriteStyleIds, getVisibleStyles } from "@/app/org/[orgId]/styles/styles-data";
import { StyleGallery } from "@/app/org/[orgId]/styles/style-gallery";
import { PageHeader } from "../ui";
import { KeysAgencyPicker } from "./keys-agency-picker";

// Preview generation polls the provider inline (up to ~180s).
export const maxDuration = 180;

export default function PlatformStylesPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-2 py-6">
      <PageHeader
        title="Styles"
        description="The built-in visual styles every agency picks from. Generate their gallery preview images here."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-border" />}>
        <GatedStyles searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function GatedStyles({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const user = await requirePlatformAdmin();
  const { org } = await searchParams;
  const supabase = await createClient();

  // Previews run on an agency's own provider keys, so only agencies you
  // are a member of are offered — never charge another agency's keys.
  const { data: memberships } = await supabase
    .from("org_members")
    .select("org_id, orgs!inner(name)")
    .eq("user_id", user.id)
    .eq("seat_active", true);
  const agencies = (memberships ?? []).map((m) => ({
    id: m.org_id as string,
    name: (m.orgs as unknown as { name: string }).name,
  }));

  if (agencies.length === 0) {
    return (
      <p className="card p-6 text-sm text-foreground-muted">
        Previews are generated on an agency&apos;s provider keys, and you aren&apos;t a member of any agency yet.
      </p>
    );
  }

  const orgId = agencies.some((a) => a.id === org) ? org! : agencies[0].id;
  const [styles, favouriteIds, modelOptions, providersWithKeys] = await Promise.all([
    getVisibleStyles(orgId).then((all) => all.filter((s) => s.org_id === null)),
    getFavouriteStyleIds(user.id),
    getModelOptions("image"),
    getProvidersWithKeys(orgId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <KeysAgencyPicker agencies={agencies} selected={orgId} hasImageKey={providersWithKeys.some((p) => p === "kie" || p === "fal")} />
      <StyleGallery
        orgId={orgId}
        styles={styles}
        favouriteIds={Array.from(favouriteIds)}
        preview={{ platformAdmin: true, orgAdmin: false, modelOptions, providersWithKeys }}
      />
    </div>
  );
}
