import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { placeMarketOrder, getOrder, getLatestPrice } from "@/lib/alpaca";

// ─── Types (mirrors Python ThesisOutput) ─────────────────────────────────────

interface ThesisOutput {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration: string;
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  signal_types: string[];
  sector: string | null;
  sources_used: object[];
  model_used: string;
}

interface PythonRunResponse {
  theses: ThesisOutput[];
  tickers_researched: number;
  duration_seconds: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Poll Alpaca for fill price (≤8s). Falls back to latest market price,
 * then to the thesis entry price if Alpaca is unavailable.
 */
async function waitForFill(
  orderId: string,
  symbol: string,
  fallback: number,
  maxMs = 8_000
): Promise<number> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const order = await getOrder(orderId);
      if (order.status === "filled" && order.filled_avg_price) {
        return parseFloat(order.filled_avg_price);
      }
    } catch {
      // continue polling
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  try {
    return await getLatestPrice(symbol);
  } catch {
    return fallback;
  }
}

// ─── Inngest function ─────────────────────────────────────────────────────────

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "";
const PYTHON_SERVICE_SECRET = process.env.PYTHON_SERVICE_SECRET ?? "";

export const morningResearch = inngest.createFunction(
  {
    id: "morning-research",
    name: "Morning Research Cron",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "0 13 * * 1-5" }, // 8 AM ET = 13:00 UTC Mon–Fri
  async ({ step }) => {
    // Step 1: Load all enabled AgentConfigs
    const configs = await step.run("load-agent-configs", async () => {
      return prisma.agentConfig.findMany({ where: { enabled: true } });
    });

    if (configs.length === 0) {
      return { skipped: true, reason: "no-active-configs" };
    }

    const results: object[] = [];

    for (const config of configs) {
      const result = await step.run(
        `research-user-${config.userId}`,
        async () => {
          // Check open position cap before running research
          const openCount = await prisma.trade.count({
            where: { userId: config.userId, status: "OPEN" },
          });

          if (openCount >= config.maxOpenPositions) {
            return {
              userId: config.userId,
              skipped: true,
              reason: "max-positions-reached",
              openCount,
              cap: config.maxOpenPositions,
            };
          }

          // Create ResearchRun with RUNNING status
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
                maxOpenPositions: config.maxOpenPositions,
                directionBias: config.directionBias,
              },
            },
          });

          // Call Python FastAPI /research/run
          // Empty watchlist → Python auto-discovers candidates via get_research_candidates
          const tickers = config.watchlist.length > 0 ? config.watchlist : [];

          let pyResult: PythonRunResponse;
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
                  maxOpenPositions: config.maxOpenPositions,
                  maxPositionSize: config.maxPositionSize,
                  sectors: config.sectors,
                  markets: config.markets,
                  signalTypes: config.signalTypes,
                },
              }),
              signal: AbortSignal.timeout(120_000), // 2-min budget
            });

            if (!res.ok) {
              const body = await res.text().catch(() => "");
              await prisma.researchRun.update({
                where: { id: run.id },
                data: { status: "FAILED", completedAt: new Date() },
              });
              return {
                userId: config.userId,
                runId: run.id,
                error: `Python service ${res.status}: ${body}`,
              };
            }

            pyResult = (await res.json()) as PythonRunResponse;
          } catch (err) {
            await prisma.researchRun.update({
              where: { id: run.id },
              data: { status: "FAILED", completedAt: new Date() },
            });
            return {
              userId: config.userId,
              runId: run.id,
              error: `Fetch failed: ${String(err)}`,
            };
          }

          // Persist theses + place paper trades for qualifying results
          const thesisIds: string[] = [];
          const tradeIds: string[] = [];
          let slotsRemaining = config.maxOpenPositions - openCount;

          for (const thesis of pyResult.theses ?? []) {
            // Save thesis
            const row = await prisma.thesis.create({
              data: {
                researchRunId: run.id,
                userId: config.userId,
                ticker: thesis.ticker,
                source: "AGENT",
                direction: thesis.direction,
                entryPrice: thesis.entry_price,
                targetPrice: thesis.target_price,
                stopLoss: thesis.stop_loss,
                holdDuration: thesis.hold_duration || "SWING",
                confidenceScore: thesis.confidence_score,
                reasoningSummary: thesis.reasoning_summary,
                thesisBullets: thesis.thesis_bullets ?? [],
                riskFlags: thesis.risk_flags ?? [],
                signalTypes: thesis.signal_types ?? [],
                sector: thesis.sector,
                sourcesUsed: (thesis.sources_used ?? []) as object,
                modelUsed: thesis.model_used || "gpt-4o",
              },
            });
            thesisIds.push(row.id);

            // Place paper trade for actionable theses within position cap
            if (
              thesis.direction !== "PASS" &&
              thesis.confidence_score >= config.minConfidence &&
              thesis.entry_price != null &&
              slotsRemaining > 0
            ) {
              const shares = Math.max(
                1,
                Math.floor(config.maxPositionSize / thesis.entry_price)
              );

              let fillPrice = thesis.entry_price;
              let alpacaOrderId: string | null = null;

              try {
                const order = await placeMarketOrder({
                  symbol: thesis.ticker,
                  qty: shares,
                  side: thesis.direction === "LONG" ? "buy" : "sell",
                });
                alpacaOrderId = order.id;
                fillPrice = await waitForFill(
                  order.id,
                  thesis.ticker,
                  thesis.entry_price
                );
              } catch {
                // Alpaca unavailable — fall back to thesis entry price
              }

              const trade = await prisma.trade.create({
                data: {
                  thesisId: row.id,
                  userId: config.userId,
                  ticker: thesis.ticker,
                  direction: thesis.direction as "LONG" | "SHORT",
                  status: "OPEN",
                  entryPrice: fillPrice,
                  shares,
                  targetPrice: thesis.target_price,
                  stopLoss: thesis.stop_loss,
                  exitStrategy: "PRICE_TARGET",
                  alpacaOrderId,
                },
              });

              await prisma.tradeEvent.create({
                data: {
                  tradeId: trade.id,
                  eventType: "PLACED",
                  description: `Auto-placed by morning research cron at $${fillPrice.toFixed(2)} (conf: ${thesis.confidence_score}%)`,
                  priceAt: fillPrice,
                },
              });

              tradeIds.push(trade.id);
              slotsRemaining--;
            }
          }

          // Mark ResearchRun COMPLETE
          await prisma.researchRun.update({
            where: { id: run.id },
            data: { status: "COMPLETE", completedAt: new Date() },
          });

          return {
            userId: config.userId,
            runId: run.id,
            thesisIds,
            tradeIds,
            tickersResearched: pyResult.tickers_researched ?? thesisIds.length,
            tradesPlaced: tradeIds.length,
          };
        }
      );

      results.push(result);
    }

    return { results };
  }
);
