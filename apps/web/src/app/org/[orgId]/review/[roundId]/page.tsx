import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getScenes } from "@/app/org/[orgId]/brands/[brandId]/products/[productId]/ads/scenes-data";
import {
  getSceneImages,
  getAssetSignedUrlsByPath,
} from "@/app/org/[orgId]/brands/[brandId]/products/[productId]/ads/scene-images-data";
import { getSceneVideos } from "@/app/org/[orgId]/brands/[brandId]/products/[productId]/ads/scene-videos-data";
import { ReviewForm, type ReviewScene, type PastRound } from "./review-form";

export default function ReviewPage({ params }: { params: Promise<{ orgId: string; roundId: string }> }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-border" />}>
        <GatedReview params={params} />
      </Suspense>
    </main>
  );
}

async function GatedReview({ params }: { params: Promise<{ orgId: string; roundId: string }> }) {
  const { orgId, roundId } = await params;
  await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const { data: round } = await supabase
    .from("review_rounds")
    .select("id, task_id, ad_id, round_no, status, overall_note, submitted_at, reviewed_at")
    .eq("org_id", orgId)
    .eq("id", roundId)
    .maybeSingle();
  if (!round) notFound();

  const { data: task } = await supabase
    .from("tasks")
    .select("id, title, description, assignee_id")
    .eq("id", round.task_id)
    .maybeSingle();
  if (!task) notFound();

  const [{ data: assignee }, { data: allRounds }] = await Promise.all([
    task.assignee_id
      ? supabase.from("profiles").select("full_name").eq("user_id", task.assignee_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("review_rounds")
      .select("id, round_no, status, overall_note, reviewed_at, scene_reviews(scene_id, verdict, comment)")
      .eq("task_id", task.id)
      .order("round_no", { ascending: false }),
  ]);

  const header = (
    <div className="flex flex-col gap-1">
      <Link href={`/org/${orgId}/board`} className="text-xs font-medium uppercase tracking-wide text-foreground-muted hover:underline">
        Board
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
      <p className="text-sm text-foreground-muted">
        Review round {round.round_no}
        {assignee?.full_name ? ` · by ${assignee.full_name}` : ""}
      </p>
    </div>
  );

  if (!round.ad_id) {
    return (
      <>
        {header}
        <p className="card-inset px-4 py-3 text-sm text-foreground-muted">
          No ad is linked to this task yet. Link one from the task on the board (or ask the editor to), then come back to review it.
        </p>
      </>
    );
  }

  const { data: ad } = await supabase
    .from("ads")
    .select("id, name, brand_id, product_id, brief")
    .eq("org_id", orgId)
    .eq("id", round.ad_id)
    .maybeSingle();
  if (!ad) notFound();

  const [scenes, imagesByScene, videosByScene] = await Promise.all([
    getScenes(orgId, ad.id),
    getSceneImages(orgId, ad.id),
    getSceneVideos(orgId, ad.id),
  ]);

  // "Current" = the newest non-archived image/video for each scene.
  const current = scenes.map((scene) => ({
    scene,
    image: imagesByScene[scene.id]?.at(-1) ?? null,
    video: videosByScene[scene.id]?.at(-1) ?? null,
  }));
  const urls = await getAssetSignedUrlsByPath(
    current.flatMap((c) => [c.image?.storage_path, c.video?.storage_path]).filter((p): p is string => Boolean(p))
  );

  const reviewScenes: ReviewScene[] = current.map(({ scene, image, video }) => ({
    id: scene.id,
    number: scene.idx + 1,
    copy: scene.copy,
    visual: scene.visual,
    imageUrl: image ? urls[image.storage_path] ?? null : null,
    videoUrl: video ? urls[video.storage_path] ?? null : null,
  }));

  type RoundRow = {
    id: string;
    round_no: number;
    status: string;
    overall_note: string | null;
    reviewed_at: string | null;
    scene_reviews: { scene_id: string; verdict: "approved" | "changes"; comment: string | null }[];
  };
  const rounds = (allRounds ?? []) as RoundRow[];
  const thisRound = rounds.find((r) => r.id === round.id);
  const pastRounds: PastRound[] = rounds
    .filter((r) => r.round_no < round.round_no && r.status !== "open")
    .map((r) => ({
      roundNo: r.round_no,
      status: r.status,
      overallNote: r.overall_note,
      changes: r.scene_reviews
        .filter((sr) => sr.verdict === "changes")
        .map((sr) => ({
          sceneNumber: (scenes.find((s) => s.id === sr.scene_id)?.idx ?? 0) + 1,
          comment: sr.comment,
        })),
    }));

  const brief = (ad.brief ?? {}) as { hooks?: string[]; idea?: string };
  const adName = ad.name || brief.hooks?.[0] || brief.idea || "Untitled ad";

  return (
    <>
      {header}
      <ReviewForm
        orgId={orgId}
        roundId={round.id}
        adId={ad.id}
        status={round.status as "open" | "changes_requested" | "approved"}
        adName={adName}
        adHref={`/org/${orgId}/brands/${ad.brand_id}/products/${ad.product_id}/ads/${ad.id}`}
        scenes={reviewScenes}
        submitted={
          round.status === "open"
            ? null
            : {
                overallNote: round.overall_note,
                verdicts: Object.fromEntries(
                  (thisRound?.scene_reviews ?? []).map((sr) => [sr.scene_id, { verdict: sr.verdict, comment: sr.comment }])
                ),
              }
        }
        pastRounds={pastRounds}
      />
    </>
  );
}
