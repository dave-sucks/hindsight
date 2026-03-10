export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { RunEvent } from "@/lib/generated/prisma/client";

const POLL_INTERVAL_MS = 2000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Verify ownership ──────────────────────────────────────────────────────
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId: user.id },
    select: { id: true, status: true },
  });

  if (!run) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastCreatedAt: Date | null = null;
      const abortSignal = req.signal;

      const sendEvent = (data: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        while (!abortSignal.aborted) {
          // Fetch new events since last cursor
          const newEvents: RunEvent[] = await prisma.runEvent.findMany({
            where: {
              runId,
              ...(lastCreatedAt ? { createdAt: { gt: lastCreatedAt } } : {}),
            },
            orderBy: { createdAt: "asc" },
          });

          for (const ev of newEvents) {
            sendEvent({
              type: ev.type,
              title: ev.title,
              message: ev.message,
              payload: ev.payload,
              createdAt: ev.createdAt.toISOString(),
            });
            lastCreatedAt = ev.createdAt;
          }

          // Check if run is terminal
          const current = await prisma.researchRun.findUnique({
            where: { id: runId },
            select: { status: true },
          });

          if (
            current?.status === "COMPLETE" ||
            current?.status === "FAILED"
          ) {
            sendEvent({ type: "stream.done", title: "Run finished", status: current.status });
            break;
          }

          // Wait before next poll
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, POLL_INTERVAL_MS);
            abortSignal.addEventListener("abort", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      } catch {
        // Client disconnected — normal
      } finally {
        controller.close();
      }
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
