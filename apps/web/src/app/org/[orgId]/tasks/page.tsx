import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireOrgMember, isOrgAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBoardData } from "../board/board-data";
import { TaskBoard } from "../board/task-board";
import { BoardSkeleton } from "../board/board-skeleton";

export default function MyTasksPage({ params }: { params: Promise<{ orgId: string }> }) {
  return (
    <main className="flex min-h-screen min-w-0 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">My tasks</h1>
      <Suspense fallback={<BoardSkeleton />}>
        <GatedMyTasks params={params} />
      </Suspense>
    </main>
  );
}

async function GatedMyTasks({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireOrgMember(orgId);
  // Owners and admins work from the full board.
  if (await isOrgAdmin(orgId)) redirect(`/org/${orgId}/board`);

  const supabase = await createClient();
  const [data, { data: profile }] = await Promise.all([
    // tasks_select RLS returns only tasks assigned to this user.
    getBoardData(orgId, { manage: false }),
    supabase.from("profiles").select("full_name, avatar_path").eq("user_id", user.id).maybeSingle(),
  ]);

  return (
    <TaskBoard
      orgId={orgId}
      mode="mine"
      data={data}
      viewer={{ id: user.id, email: user.email, name: profile?.full_name ?? null, avatarPath: profile?.avatar_path ?? null }}
    />
  );
}
