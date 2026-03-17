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

    // Step 2: Call Python service for GPT-4o evaluation
    const evaluation = await step.run("run-evaluation", async () => {
      const pythonUrl = process.env.PYTHON_SERVICE_URL;
      const secret = process.env.PYTHON_SERVICE_SECRET;

      if (!pythonUrl) {
        throw new Error("PYTHON_SERVICE_URL not configured");
      }

      const holdDays = daysBetween(position.openedAt as unknown as string, position.closedAt as unknown as string | null);

      const response = await fetch(`${pythonUrl}/research/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Secret": secret ?? "",
        },
        body: JSON.stringify({
          ticker: position.symbol,
          direction: position.direction,
          entry_price: position.avgCost,
          close_price: position.closePrice,
          outcome: position.outcome,
          close_reason: position.closeReason ?? "MANUAL",
          thesis_summary: thesis?.reasoningSummary ?? null,
          signal_types: thesis?.signalTypes ?? [],
          hold_days: holdDays,
        }),
      });

      if (!response.ok) {
        throw new Error(`Python service returned ${response.status}`);
      }

      const data = (await response.json()) as { evaluation_text: string };
      return data.evaluation_text;
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

    return { positionId, evaluated: true };
  }
);
