import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(from: string | Date, to: string | Date | null): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const evaluateTrade = inngest.createFunction(
  {
    id: "evaluate-trade",
    name: "Post-Trade Agent Evaluation",
    // Don't retry — evaluation is best-effort and trade is already closed
    retries: 1,
  },
  { event: "trade/closed" },
  async ({ event, step }) => {
    const { positionId } = event.data as { positionId: string };

    // Step 1: Fetch position + thesis from DB
    const position = await step.run("fetch-position", async () => {
      return prisma.position.findUnique({
        where: { id: positionId },
        include: {
          decisions: {
            take: 1,
            include: {
              thesis: {
                select: {
                  reasoningSummary: true,
                  signalTypes: true,
                  thesisBullets: true,
                  sourceSignalIds: true,
                },
              },
            },
          },
        },
      });
    });

    if (!position) {
      return { skipped: true, reason: "position-not-found" };
    }

    if (!position.closePrice || !position.outcome) {
      return { skipped: true, reason: "position-not-closed" };
    }

    const thesis = position.decisions[0]?.thesis;

    // Step 2: GPT-4o evaluation (direct call, no Railway dependency)
    const evaluation = await step.run("run-evaluation", async () => {
      const holdDays = daysBetween(position.openedAt as unknown as string, position.closedAt as unknown as string | null);
      const pnlPct = ((Number(position.closePrice) - Number(position.avgCost)) / Number(position.avgCost) * 100).toFixed(2);

      const { text } = await generateText({
        model: openai("gpt-4o"),
        system: "You are a trading coach evaluating closed paper trades. Be honest and constructive. Focus on what the analyst got right, what they missed, and what they should learn. Keep it to 3-4 paragraphs.",
        prompt: `Evaluate this closed paper trade:

Ticker: ${position.symbol}
Direction: ${position.direction}
Entry: $${position.avgCost}
Exit: $${position.closePrice}
P&L: ${pnlPct}%
Outcome: ${position.outcome}
Close reason: ${position.closeReason ?? "MANUAL"}
Hold duration: ${holdDays} days
${thesis?.reasoningSummary ? `\nOriginal thesis: ${thesis.reasoningSummary}` : ""}
${thesis?.signalTypes?.length ? `Signal types: ${thesis.signalTypes.join(", ")}` : ""}
${thesis?.thesisBullets?.length ? `\nKey bullets:\n${thesis.thesisBullets.map((b: string) => `- ${b}`).join("\n")}` : ""}

Write an honest post-trade evaluation. Was the thesis correct? Was sizing appropriate? What should the analyst learn from this trade?`,
        maxOutputTokens: 500,
      });

      return text;
    });

    // Step 3: Store evaluation + write EVALUATED PositionEvent
    await step.run("store-evaluation", async () => {
      await prisma.position.update({
        where: { id: positionId },
        data: { agentEvaluation: evaluation },
      });

      await prisma.positionEvent.create({
        data: {
          positionId,
          eventType: "EVALUATED",
          description: evaluation,
          priceAt: null,
          pnlAt: null,
        },
      });
    });

    // Step 4: Walk Thesis → Signal → Monitor and update per-monitor ROI counters.
    // Credits/debits every Monitor whose signal informed this thesis with a
    // win/loss and recomputes successScore. Historical theses with empty
    // sourceSignalIds or signals with null monitorId skip silently.
    const monitorUpdate = await step.run("update-monitor-outcomes", async () => {
      const signalIds = thesis?.sourceSignalIds ?? [];
      if (signalIds.length === 0) {
        return { skipped: true, reason: "no-source-signals" };
      }

      const signals = await prisma.signal.findMany({
        where: { id: { in: signalIds } },
        select: { monitorId: true },
      });

      const monitorIds = Array.from(
        new Set(signals.map((s) => s.monitorId).filter((id): id is string => !!id))
      );

      if (monitorIds.length === 0) {
        return { skipped: true, reason: "no-monitor-linked-signals" };
      }

      const outcome = position.outcome;
      const isWin = outcome === "WIN";
      const isLoss = outcome === "LOSS";
      const now = new Date();

      const updated: Array<{ monitorId: string; successScore: number; tradesSourced: number }> = [];

      // Per-monitor update — recompute successScore from the new totals inside
      // a transaction so concurrent closes don't stomp each other.
      for (const monitorId of monitorIds) {
        const result = await prisma.$transaction(async (tx) => {
          const bumped = await tx.monitor.update({
            where: { id: monitorId },
            data: {
              tradesSourced: { increment: 1 },
              winsSourced: { increment: isWin ? 1 : 0 },
              lossesSourced: { increment: isLoss ? 1 : 0 },
              lastOutcomeAt: now,
            },
            select: {
              tradesSourced: true,
              winsSourced: true,
              lossesSourced: true,
            },
          });
          const successScore = bumped.tradesSourced > 0
            ? (bumped.winsSourced - bumped.lossesSourced) / bumped.tradesSourced
            : null;
          await tx.monitor.update({
            where: { id: monitorId },
            data: { successScore },
          });
          return { successScore: successScore ?? 0, tradesSourced: bumped.tradesSourced };
        });
        updated.push({ monitorId, ...result });
      }

      return { monitorsUpdated: updated.length, details: updated };
    });

    return { positionId, evaluated: true, monitorUpdate };
  }
);
