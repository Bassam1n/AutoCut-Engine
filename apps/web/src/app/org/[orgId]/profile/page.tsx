import { Suspense } from "react";
import { requireOrgMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

export default function ProfilePage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">My profile</h1>
      <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-border" />}>
        <GatedProfile params={params} />
      </Suspense>
    </main>
  );
}

async function GatedProfile({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireOrgMember(orgId);
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, avatar_path")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <ProfileForm
      orgId={orgId}
      userId={user.id}
      email={user.email}
      initialName={profile?.full_name ?? ""}
      initialPhone={profile?.phone ?? ""}
      initialAvatarPath={profile?.avatar_path ?? null}
    />
  );
}
