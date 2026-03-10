import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/research/events?runId=xxx
 *
 * SSE endpoint that:
 *  1. Replays all stored RunEvent rows for the run immediately.
 *  2. If the run is still RUNNING, polls for new events every 2 s until
 *     run_complete / error arrives or the run transitions to a terminal status.
 *  3. If the run is already COMPLETE / FAILED, replays and closes.
 *
 * Used by RunLiveStream client component on /runs/[id] for RUNNING status runs.
 */
export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) return new Response("Missing runId", { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Verify run ownership
      const run = await prisma.researchRun.findFirst({
        where: { id: runId, userId: user.id },
        select: { status: true },
      });

      if (!run) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: "Run not found" })}\n\n`
          )
        );
        controller.close();
        return;
      }

      // Replay all events stored so far
      const stored = await prisma.runEvent.findMany({
        where: { runId },
        orderBy: { createdAt: "asc" },
      });

      let lastCreatedAt =
        stored.length > 0 ? stored[stored.length - 1].createdAt : new Date(0);

      for (const ev of stored) {
        const payload = (ev.payload as Record<string, unknown>) ?? {};
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        );
      }

      // If terminal, we're done
      const isTerminal =
        run.status === "COMPLETE" || run.status === "FAILED";
      if (isTerminal) {
        controller.close();
        return;
      }

      // Check if a run_complete event was already in the stored set
      const alreadyComplete = stored.some(
        (ev) => ev.type === "run_complete" || ev.type === "error"
      );
      if (alreadyComplete) {
        controller.close();
        return;
      }

      // Live poll loop — emit new events as they are written by the proxy route
      let done = false;
      while (!done) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2_000));

        try {
          const newEvents = await prisma.runEvent.findMany({
            where: { runId, createdAt: { gt: lastCreatedAt } },
            orderBy: { createdAt: "asc" },
          });

          for (const ev of newEvents) {
            const payload = (ev.payload as Record<string, unknown>) ?? {};
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
            lastCreatedAt = ev.createdAt;
            if (ev.type === "run_complete" || ev.type === "error") {
              done = true;
            }
          }

          // Also check run status directly in case the event was missed
          if (!done) {
            const current = await prisma.researchRun.findUnique({
              where: { id: runId },
              select: { status: true },
            });
            if (
              current?.status === "COMPLETE" ||
              current?.status === "FAILED"
            ) {
              done = true;
            }
          }
        } catch {
          done = true;
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
