import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { placeMarketOrder, getOrder, getLatestPrice } from "@/lib/alpaca";

// ─── Types ────────────────────────────────────────────────────────────────────

type ThesisOutput = {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration: "DAY" | "SWING" | "POSITION";
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  signal_types: string[];
  sector: string | null;
  sources_used: {
    type: string;
    provider: string;
    title: string;
    url?: string | null;
    published_at?: string | null;
  }[];
  model_used: string;
};

type RunResponse = {
  theses: ThesisOutput[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Poll Alpaca until the order fills or until timeout (8s budget for cron context).
 * Falls back to latest market price when market is closed or fill is slow.
 */
async function waitForFill(
  orderId: string,
  symbol: string,
  fallbackPrice: number,
  maxMs = 8_000
): Promise<number> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const order = await getOrder(orderId);
    if (order.status === "filled" && order.filled_avg_price) {
      return parseFloat(order.filled_avg_price);
    }
    if (
      order.status === "cancelled" ||
      order.status === "expired" ||
      order.status === "rejected"
    ) {
      throw new Error(`Alpaca order ${order.status}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  try {
    return await getLatestPrice(symbol);
  } catch {
    return fallbackPrice;
  }
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const morningResearch = inngest.createFunction(
  {
    id: "morning-research",
    name: "Morning Research Cron",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "0 13 * * 1-5" }, // 8:00 AM ET = 13:00 UTC, Mon–Fri
    { event: "app/research.run.manual" },
  ],
  async ({ step }) => {
    const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "";
    const PYTHON_SERVICE_SECRET = process.env.PYTHON_SERVICE_SECRET ?? "";

    // ── Step 1: Load all enabled AgentConfigs ────────────────────────────────

    const configs = await step.run("load-agent-configs", async () => {
      return prisma.agentConfig.findMany({ where: { enabled: true } });
    });

    if (configs.length === 0) {
      return { ran: 0, reason: "no-enabled-configs" };
    }

    if (!PYTHON_SERVICE_URL) {
      return { ran: 0, reason: "PYTHON_SERVICE_URL-not-configured" };
    }

    let totalTradesPlaced = 0;

    // ── Step 2: Per-user research run ────────────────────────────────────────

    for (const config of configs) {
      await step.run(`research-${config.userId}`, async () => {
        // 2a. Check open positions cap
        const openCount = await prisma.trade.count({
          where: { userId: config.userId, status: "OPEN" },
        });
        const slotsRemaining = config.maxOpenPositions - openCount;

        if (slotsRemaining <= 0) {
          return { skipped: true, reason: "max-open-positions-reached" };
        }

        // 2b. Determine tickers to research
        // If watchlist is configured, use it; otherwise Python auto-discovers
        const tickers: string[] = config.watchlist?.length ? config.watchlist : [];

        // 2c. Create ResearchRun record (status: RUNNING)
        const run = await prisma.researchRun.create({
          data: {
            userId: config.userId,
            source: "AGENT",
            status: "RUNNING",
            parameters: {
              markets: config.markets,
              sectors: config.sectors,
              minConfidence: config.minConfidence,
              signalTypes: config.signalTypes,
              tickers,
            } as object,
          },
        });

        // 2d. Call Python FastAPI research pipeline
        let theses: ThesisOutput[] = [];
        try {
          const res = await fetch(`${PYTHON_SERVICE_URL}/research/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Service-Secret": PYTHON_SERVICE_SECRET,
            },
            body: JSON.stringify({
              tickers,
              source: "AGENT",
              agent_config: {
                minConfidence: config.minConfidence,
                directionBias: config.directionBias,
                holdDurations: config.holdDurations,
                maxOpenPositions: slotsRemaining,
                maxPositionSize: config.maxPositionSize,
                sectors: config.sectors,
                signalTypes: config.signalTypes,
              },
            }),
            signal: AbortSignal.timeout(120_000), // 2 min timeout
          });

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            await prisma.researchRun.update({
              where: { id: run.id },
              data: { status: "FAILED", completedAt: new Date() },
            });
            return { error: `Python service ${res.status}: ${text}` };
          }

          const data = (await res.json()) as RunResponse;
          theses = data.theses ?? [];
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await prisma.researchRun.update({
            where: { id: run.id },
            data: { status: "FAILED", completedAt: new Date() },
          });
          return { error: `Network error: ${message}` };
        }

        // 2e. Persist theses + place Alpaca paper orders for actionable signals
        let tradesPlaced = 0;
        let slotsLeft = slotsRemaining;

        for (const thesis of theses) {
          // Save thesis regardless of direction
          const thesisRow = await prisma.thesis.create({
            data: {
              researchRunId: run.id,
              userId: config.userId,
              ticker: thesis.ticker,
              source: "AGENT",
              direction: thesis.direction,
              entryPrice: thesis.entry_price,
              targetPrice: thesis.target_price,
              stopLoss: thesis.stop_loss,
              holdDuration: thesis.hold_duration,
              confidenceScore: thesis.confidence_score,
              reasoningSummary: thesis.reasoning_summary,
              thesisBullets: thesis.thesis_bullets,
              riskFlags: thesis.risk_flags,
              signalTypes: thesis.signal_types,
              sector: thesis.sector,
              sourcesUsed: thesis.sources_used as object,
              modelUsed: thesis.model_used,
            },
          });

          // Skip PASS or low-confidence or if at position cap
          if (
            thesis.direction === "PASS" ||
            thesis.confidence_score < config.minConfidence ||
            thesis.entry_price == null ||
            slotsLeft <= 0
          ) {
            continue;
          }

          // Place Alpaca paper market order
          let alpacaOrderId: string;
          try {
            const shares = Math.max(
              1,
              Math.floor(config.maxPositionSize / thesis.entry_price)
            );
            const order = await placeMarketOrder({
              symbol: thesis.ticker,
              qty: shares,
              side: thesis.direction === "LONG" ? "buy" : "sell",
            });
            alpacaOrderId = order.id;

            // Wait for fill (or estimate from latest price if market closed)
            const fillPrice = await waitForFill(
              order.id,
              thesis.ticker,
              thesis.entry_price
            );

            const shares2 = Math.max(
              1,
              Math.floor(config.maxPositionSize / thesis.entry_price)
            );

            const trade = await prisma.trade.create({
              data: {
                thesisId: thesisRow.id,
                userId: config.userId,
                ticker: thesis.ticker,
                direction: thesis.direction as "LONG" | "SHORT",
                status: "OPEN",
                entryPrice: fillPrice,
                shares: shares2,
                targetPrice: thesis.target_price,
                stopLoss: thesis.stop_loss,
                exitStrategy: thesis.target_price ? "PRICE_TARGET" : "MANUAL",
                alpacaOrderId,
              },
            });

            await prisma.tradeEvent.create({
              data: {
                tradeId: trade.id,
                eventType: "PLACED",
                description: `Agent cron: ${thesis.direction} ${thesis.ticker} at $${fillPrice.toFixed(2)}`,
                priceAt: fillPrice,
              },
            });

            tradesPlaced++;
            slotsLeft--;
            totalTradesPlaced++;
          } catch {
            // Order failed — don't block the rest of the run
            continue;
          }
        }

        // 2f. Mark ResearchRun COMPLETE
        await prisma.researchRun.update({
          where: { id: run.id },
          data: {
            status: "COMPLETE",
            completedAt: new Date(),
            parameters: {
              ...(run.parameters as object),
              thesesGenerated: theses.length,
              tradesPlaced,
            } as object,
          },
        });

        return { thesesGenerated: theses.length, tradesPlaced };
      });
    }

    return { ran: configs.length, totalTradesPlaced };
  }
);
