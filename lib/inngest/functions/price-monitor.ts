import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getLatestPrices } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { isMarketOpen } from "@/lib/market-hours";
import { checkExitConditions } from "@/lib/trade-exit";
import type { PositionModel } from "@/lib/generated/prisma/models";

// ─── P&L helpers ─────────────────────────────────────────────────────────────

function calculatePnl(
  position: PositionModel,
  currentPrice: number
): { dollars: number; pct: number } {
  const dollars =
    position.direction === "LONG"
      ? (currentPrice - position.avgCost) * position.quantity
      : (position.avgCost - currentPrice) * position.quantity;
  const pct =
    position.direction === "LONG"
      ? ((currentPrice - position.avgCost) / position.avgCost) * 100
      : ((position.avgCost - currentPrice) / position.avgCost) * 100;
  return { dollars, pct };
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const priceMonitor = inngest.createFunction(
  {
    id: "price-monitor",
    name: "Hourly Price Monitor",
    retries: 0,
  },
  { cron: "TZ=America/New_York 0 9-17 * * 1-5" },
  async ({ step }) => {
    // Step 1: Fetch all OPEN positions
    const openPositions = await step.run("fetch-open-positions", async () => {
      return prisma.position.findMany({ where: { status: "OPEN" } });
    });

    if (openPositions.length === 0) return { checked: 0, reason: "no-open-positions" };

    // Step 2: Skip if market is closed
    const marketOpen = await step.run("check-market-hours", async () => {
      return isMarketOpen();
    });

    if (!marketOpen) {
      return { checked: 0, reason: "market-closed" };
    }

    // Step 3: Batch fetch current prices via Alpaca Data API
    const uniqueTickers = [...new Set(openPositions.map((p) => p.symbol))];

    const priceMap = await step.run("fetch-prices", async () => {
      try {
        // Use the first user's creds for market data (same prices for all accounts)
        const firstUserId = openPositions[0]?.userId;
        const creds = firstUserId ? await resolveAlpacaCredentials(firstUserId) ?? undefined : undefined;
        return await getLatestPrices(uniqueTickers, creds);
      } catch {
        return {} as Record<string, number>;
      }
    });

    // Step 4: Per-position price check + exit condition evaluation
    let checked = 0;
    let errors = 0;

    for (const position of openPositions) {
      await step.run(`check-position-${position.id}`, async () => {
        try {
          const currentPrice = priceMap[position.symbol];
          if (!currentPrice) {
            await prisma.positionEvent.create({
              data: {
                positionId: position.id,
                eventType: "PRICE_CHECK",
                description: `Price unavailable for ${position.symbol}`,
                priceAt: null,
                pnlAt: null,
              },
            });
            return;
          }

          const pnl = calculatePnl(position as unknown as PositionModel, currentPrice);

          // Maintain running peak/trough on the Position row itself (avoids recomputing from events)
          const isLong = position.direction === "LONG";
          const peakUpdate: Record<string, number | Date> = {};
          if (isLong) {
            if (!position.peakPrice || currentPrice > position.peakPrice) {
              peakUpdate.peakPrice = currentPrice;
              peakUpdate.peakAt = new Date();
            }
            if (!position.troughPrice || currentPrice < position.troughPrice) {
              peakUpdate.troughPrice = currentPrice;
              peakUpdate.troughAt = new Date();
            }
          } else {
            // SHORT: peak = lowest price seen, trough = highest
            if (!position.peakPrice || currentPrice < position.peakPrice) {
              peakUpdate.peakPrice = currentPrice;
              peakUpdate.peakAt = new Date();
            }
            if (!position.troughPrice || currentPrice > position.troughPrice) {
              peakUpdate.troughPrice = currentPrice;
              peakUpdate.troughAt = new Date();
            }
          }
          if (Object.keys(peakUpdate).length > 0) {
            await prisma.position.update({ where: { id: position.id }, data: peakUpdate });
          }

          // Write PRICE_CHECK event
          await prisma.positionEvent.create({
            data: {
              positionId: position.id,
              eventType: "PRICE_CHECK",
              description: `Price check: $${currentPrice.toFixed(2)} (${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(1)}%)`,
              priceAt: currentPrice,
              pnlAt: pnl.dollars,
            },
          });

          // Trailing-stop check (TRAILING-only after Fix #0 — see
          // docs/MORNING_RUN_V2_DESIGN.md). Per-thesis EXIT triggers
          // handle every other exit path via the trigger evaluator's
          // 5-min cron. checkExitConditions early-returns for any
          // non-TRAILING exitStrategy; the call here exists so positions
          // that opted into manage_position.set_trailing_stop continue
          // to honor their trail-from-peak math.
          await checkExitConditions(position as unknown as PositionModel, currentPrice, position.peakPrice);

          // Near-target email alert removed — the daily digest at 10 AM ET
          // covers position movement; intraday "80% to target" pings turned
          // out to be noise, not signal. The nearTargetAlertSent column is
          // left in place (no migration) but no longer written.

          checked++;
        } catch {
          errors++;
        }
      });
    }

    return { checked, errors, total: openPositions.length };
  }
);
