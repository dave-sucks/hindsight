export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { persistThesesAndTrades, type ThesisOutput } from "@/lib/actions/run-persistence";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "";
const PYTHON_SERVICE_SECRET = process.env.PYTHON_SERVICE_SECRET ?? "";

export async function POST(req: NextRequest) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(
      `data: ${JSON.stringify({ type: "run.error", title: "Unauthorized" })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  if (!PYTHON_SERVICE_URL) {
    return new Response(
      `data: ${JSON.stringify({ type: "run.error", title: "Python service not configured" })}\n\n`,
      { status: 503, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const body = await req.json().catch(() => ({})) as {
    tickers?: string[];
    source?: "AGENT" | "MANUAL";
    agentConfigId?: string;
    autoTrade?: boolean;
  };

  const source = body.source ?? "MANUAL";

  // ── 2. Load agent config ──────────────────────────────────────────────────
  const agentConfig = body.agentConfigId
    ? await prisma.agentConfig
        .findFirst({ where: { id: body.agentConfigId, userId: user.id } })
        .catch(() => null)
    : await prisma.agentConfig
        .findFirst({ where: { userId: user.id, enabled: true } })
        .catch(() => null);

  const agentConfigPayload = agentConfig ?? {
    minConfidence: 70,
    directionBias: "BOTH",
    holdDurations: ["SWING"],
    maxOpenPositions: 5,
    maxPositionSize: 500,
  };

  const minConfidence = (agentConfig?.minConfidence ?? 70) as number;
  // MANUAL runs default to recommend-only; autoTrade=true must be explicit
  const autoTrade =
    source === "AGENT"
      ? (agentConfig?.tradePolicyAutoTrade ?? true)
      : (body.autoTrade ?? false);

  // ── 3. Create ResearchRun with status RUNNING ─────────────────────────────
  const run = await prisma.researchRun.create({
    data: {
      userId: user.id,
      source,
      status: "RUNNING",
      parameters: agentConfigPayload as object,
      ...(agentConfig ? { agentConfigId: agentConfig.id } : {}),
    },
  });

  // ── 4. Fetch upstream SSE stream from Python service ─────────────────────
  let upstream: Response;
  try {
    upstream = await fetch(`${PYTHON_SERVICE_URL}/research/run/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Secret": PYTHON_SERVICE_SECRET,
      },
      body: JSON.stringify({
        tickers: body.tickers ?? [],
        source,
        agent_config: agentConfigPayload,
      }),
      signal: AbortSignal.timeout(300_000), // 5 min budget for full run
    });
  } catch (err) {
    await prisma.researchRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date() },
    });
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `data: ${JSON.stringify({ type: "run.error", title: "Failed to reach Python service", message: msg })}\n\n`,
      { status: 502, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // ── 5. Relay-and-persist single ReadableStream ────────────────────────────
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send runId immediately so the browser can navigate to the run page
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "run.created", title: "Run created", runId: run.id })}\n\n`
        )
      );

      const reader = upstream.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Forward raw chunk to browser
          controller.enqueue(value);

          // Parse SSE lines to persist events + handle run.completed
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            const type = String(event.type ?? "");
            if (!type || type === "run.created") continue;

            console.log("Stream event received:", type);

            // Fire-and-forget persist — never block the stream relay on a DB write.
            // run.completed is handled separately below (awaited) to ensure theses
            // are persisted before the run status flips to COMPLETE.
            if (type !== "run.completed") {
              prisma.runEvent
                .create({
                  data: {
                    runId: run.id,
                    type,
                    title: String(event.title ?? type),
                    message: event.message ? String(event.message) : undefined,
                    ...(event.payload
                      ? { payload: event.payload as object }
                      : {}),
                  },
                })
                .catch((err) =>
                  console.error("[stream] runEvent persist failed", type, err)
                );
            }

            if (type === "run.completed") {
              // Persist the run.completed event itself (awaited — last event)
              await prisma.runEvent
                .create({
                  data: {
                    runId: run.id,
                    type,
                    title: String(event.title ?? type),
                    message: event.message ? String(event.message) : undefined,
                    ...(event.payload
                      ? { payload: event.payload as object }
                      : {}),
                  },
                })
                .catch((err) =>
                  console.error("[stream] run.completed persist failed", err)
                );

              const theses = (
                (event.payload as Record<string, unknown>)?.theses ?? []
              ) as ThesisOutput[];

              await persistThesesAndTrades(
                run.id,
                user.id,
                theses,
                minConfidence,
                agentConfig,
                autoTrade,
              );

              await prisma.researchRun.update({
                where: { id: run.id },
                data: { status: "COMPLETE", completedAt: new Date() },
              });
            }
          }
        }
      } catch {
        await prisma.researchRun.update({
          where: { id: run.id },
          data: { status: "FAILED", completedAt: new Date() },
        });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "run.error", title: "Stream error" })}\n\n`
          )
        );
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
