/**
 * indicator-snapshot — 6:30 AM ET every weekday: compute the chart for every
 * ticker on the book and store the numbers a trigger reads. DAV-247.
 *
 * "On the book" = every HOLDING / WATCHING / PROMOTED thesis under an
 * enabled analyst — the same set the trigger evaluator walks. One year of
 * completed SIP daily bars per ticker (lib/alpaca.ts getDailyBars), SPY
 * once, lib/market-data/price-structure.ts for the arithmetic, one
 * TickerIndicators row per (ticker, session).
 *
 * Also listens for `app/indicators.refresh` so a fresh deploy (or a person)
 * can fill the table without waiting for the morning.
 *
 * Fail-open per ticker: a name whose bars don't come back is skipped and
 * named in the log line; the rest are written.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getDailyBars } from "@/lib/alpaca";
import { computePriceStructure } from "@/lib/market-data/price-structure";
import { toIndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { CHART_SESSIONS } from "@/lib/market-data/benchmark-bars";

/** Tickers per step — bounds one step's wall time (≈10 Alpaca pulls). */
const CHUNK = 10;

export const indicatorSnapshot = inngest.createFunction(
  {
    id: "indicator-snapshot",
    name: "Indicator Snapshot (daily chart numbers for triggers)",
    retries: 1,
    concurrency: { limit: 1 },
  },
  [{ cron: "TZ=America/New_York 30 6 * * 1-5" }, { event: "app/indicators.refresh" }],
  async ({ step }) => {
    const tickers = await step.run("book-tickers", async () => {
      const rows = await prisma.thesis.findMany({
        where: {
          status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
          researchRun: { agentConfig: { enabled: true } },
        },
        select: { ticker: true },
        distinct: ["ticker"],
      });
      return rows.map((r) => r.ticker.toUpperCase()).sort();
    });
    if (tickers.length === 0) return { written: 0, skipped: [] as string[] };

    const spy = await step.run("spy-bars", async () => (await getDailyBars("SPY", CHART_SESSIONS)).bars);

    let written = 0;
    const skipped: string[] = [];
    for (let i = 0; i < tickers.length; i += CHUNK) {
      const chunk = tickers.slice(i, i + CHUNK);
      const result = await step.run(`chunk-${i / CHUNK}`, async () => {
        let ok = 0;
        const missed: string[] = [];
        for (const ticker of chunk) {
          try {
            const { feed, bars } = await getDailyBars(ticker, CHART_SESSIONS);
            const structure = computePriceStructure({ bars, spyBars: spy });
            if (!structure) {
              missed.push(`${ticker}(${bars.length} bars)`);
              continue;
            }
            const snapshot = toIndicatorSnapshot(structure, bars);
            await prisma.tickerIndicators.upsert({
              where: { ticker_asOf: { ticker, asOf: snapshot.asOf } },
              create: { ticker, asOf: snapshot.asOf, volumeFeed: feed, snapshot: snapshot as unknown as object },
              update: { volumeFeed: feed, snapshot: snapshot as unknown as object, computedAt: new Date() },
            });
            ok++;
          } catch (err) {
            missed.push(`${ticker}(${err instanceof Error ? err.message.slice(0, 60) : "error"})`);
          }
        }
        return { ok, missed };
      });
      written += result.ok;
      skipped.push(...result.missed);
    }

    console.log(
      `[indicator-snapshot] wrote ${written}/${tickers.length}` +
        (skipped.length ? `; skipped ${skipped.join(", ")}` : ""),
    );
    return { written, skipped };
  },
);
