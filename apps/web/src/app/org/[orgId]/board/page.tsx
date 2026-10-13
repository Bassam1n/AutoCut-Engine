import { Suspense } from "react";
import { requireOrgAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBoardData } from "./board-data";
import { TaskBoard } from "./task-board";
import { BoardSkeleton } from "./board-skeleton";

export default function BoardPage({ params }: { params: Promise<{ orgId: string }> }) {
  return (
    <main className="flex min-h-screen min-w-0 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Board</h1>
      <Suspense fallback={<BoardSkeleton />}>
        <GatedBoard params={params} />
      </Suspense>
    </main>
  );
}

async function GatedBoard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  // Owners and admins only; users get My tasks instead.
  const user = await requireOrgAdmin(orgId);
  const supabase = await createClient();

  const [data, { data: profile }] = await Promise.all([
    getBoardData(orgId, { manage: true }),
    supabase.from("profiles").select("full_name, avatar_path").eq("user_id", user.id).maybeSingle(),
  ]);

  return (
    <TaskBoard
      orgId={orgId}
      mode="manage"
      data={data}
      viewer={{ id: user.id, email: user.email, name: profile?.full_name ?? null, avatarPath: profile?.avatar_path ?? null }}
    />
  );
}
