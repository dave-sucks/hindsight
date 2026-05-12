import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ChatPageClient } from "./ChatPageClient";

/**
 * Principal chat — the operator-perspective chat surface.
 *
 * Finds the most recent open PRINCIPAL_CHAT ResearchRun for this user
 * and reuses it, otherwise mints a fresh one. The id is passed to the
 * client as body.runId so write tools have a stable FK target across
 * messages in the same session.
 *
 * Defensive: every failure path falls through to "render an empty chat
 * with no runId" rather than throwing. The route's principal branch
 * will mint a run on the first POST if no runId is supplied.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  let runId: string | undefined;

  try {
    const { session: sessionParam } = await searchParams;

    let run = sessionParam
      ? await prisma.researchRun.findFirst({
          where: { id: sessionParam, userId: user.id, mode: "PRINCIPAL_CHAT" },
          select: { id: true },
        })
      : await prisma.researchRun.findFirst({
          where: {
            userId: user.id,
            mode: "PRINCIPAL_CHAT",
            status: { in: ["RUNNING", "COMPLETE"] },
          },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        });

    if (!run) {
      run = await prisma.researchRun.create({
        data: {
          userId: user.id,
          source: "MANUAL",
          status: "RUNNING",
          mode: "PRINCIPAL_CHAT",
          parameters: {} as object,
        },
        select: { id: true },
      });
    }

    runId = run.id;
  } catch (err) {
    console.error("[chat/page] failed to resolve principal-chat session:", err);
    // Render the chat without a runId — the route will mint one on first POST.
  }

  return <ChatPageClient runId={runId} />;
}
