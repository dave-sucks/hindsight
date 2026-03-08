import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";

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
    const { tradeId } = event.data as { tradeId: string };

    // Step 1: Fetch trade + thesis from DB
    const trade = await step.run("fetch-trade", async () => {
      return prisma.trade.findUnique({
        where: { id: tradeId },
        include: {
          thesis: {
            select: {
              reasoningSummary: true,
              signalTypes: true,
              thesisBullets: true,
            },
          },
        },
      });
    });

    if (!trade) {
      return { skipped: true, reason: "trade-not-found" };
    }

    if (!trade.closePrice || !trade.outcome) {
      return { skipped: true, reason: "trade-not-closed" };
    }

    // Step 2: Call Python service for GPT-4o evaluation
    const evaluation = await step.run("run-evaluation", async () => {
      const pythonUrl = process.env.PYTHON_SERVICE_URL;
      const secret = process.env.PYTHON_SERVICE_SECRET;

      if (!pythonUrl) {
        throw new Error("PYTHON_SERVICE_URL not configured");
      }

      const holdDays = daysBetween(trade.openedAt as unknown as string, trade.closedAt as unknown as string | null);

      const response = await fetch(`${pythonUrl}/research/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Secret": secret ?? "",
        },
        body: JSON.stringify({
          ticker: trade.ticker,
          direction: trade.direction,
          entry_price: trade.entryPrice,
          close_price: trade.closePrice,
          outcome: trade.outcome,
          close_reason: trade.closeReason ?? "MANUAL",
          thesis_summary: trade.thesis?.reasoningSummary ?? null,
          signal_types: trade.thesis?.signalTypes ?? [],
          hold_days: holdDays,
        }),
      });

      if (!response.ok) {
        throw new Error(`Python service returned ${response.status}`);
      }

      const data = (await response.json()) as { evaluation_text: string };
      return data.evaluation_text;
    });

    // Step 3: Store evaluation + write EVALUATED TradeEvent
    await step.run("store-evaluation", async () => {
      await prisma.trade.update({
        where: { id: tradeId },
        data: { agentEvaluation: evaluation },
      });

      await prisma.tradeEvent.create({
        data: {
          tradeId,
          eventType: "EVALUATED",
          description: evaluation,
          priceAt: null,
          pnlAt: null,
        },
      });
    });

    return { tradeId, evaluated: true };
  }
);
