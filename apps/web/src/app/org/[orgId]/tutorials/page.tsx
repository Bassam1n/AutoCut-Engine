import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOrgMember } from "@/lib/auth";
import { tutorialsForRole } from "@/lib/tutorials";
import { getSidebarInfo } from "../sidebar-data";
import { TutorialsGallery } from "./tutorials-gallery";

export default function TutorialsPage({ params }: { params: Promise<{ orgId: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tutorials</h1>
        <p className="mt-1.5 text-sm text-foreground-muted">
          Short, clickable walkthroughs of every part of AutoCut. Click the highlighted spot to move through each one.
        </p>
      </div>
      <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-border" />}>
        <GatedTutorials params={params} />
      </Suspense>
    </main>
  );
}

async function GatedTutorials({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgMember(orgId);
  const info = await getSidebarInfo(orgId);
  if (!info) notFound();
  return <TutorialsGallery orgId={orgId} tutorials={tutorialsForRole(info.role)} />;
}
